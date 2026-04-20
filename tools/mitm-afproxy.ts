#!/usr/bin/env bun
/**
 * Layer-C MitM Native-Messaging host for plaintext recovery.
 * See docs/REVERSE_ENGINEERING.md §"Layer C (MitM)".
 *
 * Sits between the browser and Strongbox's real afproxy. Impersonates
 * Strongbox to the browser (server-face keypair) and a browser extension
 * to Strongbox (client-face keypair). On every envelope it decrypts the
 * `message` ciphertext with the appropriate keypair, logs the plaintext,
 * and re-encrypts with the opposite keypair under a fresh nonce before
 * forwarding.
 *
 * Install:
 *   1. Edit the Strongbox NativeMessagingHosts manifest's "path" to point
 *      at this script (chmod +x first). Note the original path.
 *   2. Export STRONGBOX_CLI_MITM_REAL=<that original path> so this script
 *      knows where to forward to.
 *   3. Use a **fresh Chrome profile** — the extension may have pinned the
 *      real server's public key in the old profile, which would cause
 *      decryption failures on the first MitM roundtrip.
 *   4. Restart Chrome. First popup click triggers a Strongbox "allow this
 *      extension?" prompt for the MitM's client-face key; approve once.
 *   5. Drive operations. Each Chrome invocation produces a capture dir.
 *   6. Restore the manifest, restart Chrome.
 *
 * Persistent state lives under
 *   ~/Library/Application Support/strongbox-cli-mitm/
 * and per-invocation captures under
 *   ${STRONGBOX_CLI_MITM_DIR:-~/strongbox-mitm}/<timestamp>-<pid>/
 *
 * This file intentionally lives under tools/ rather than src/ so it never
 * ships as part of the CLI. It's a reverse-engineering aid and holds
 * secret keys (of impersonated identities, not of the real CLI client).
 */

import { spawn } from 'bun';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { FrameDecoder, encodeFrame } from '../src/transport/native-messaging.ts';
import {
  fromBase64,
  generateKeyPair,
  open as boxOpen,
  randomNonce,
  seal as boxSeal,
  toBase64,
  type KeyPair,
} from '../src/crypto/box.ts';

/* ─── Configuration ────────────────────────────────────────────────────── */

const MITM_STATE_DIR = join(homedir(), 'Library', 'Application Support', 'strongbox-cli-mitm');
const SERVER_FACE_PATH = join(MITM_STATE_DIR, 'server-face.json');
const CLIENT_FACE_PATH = join(MITM_STATE_DIR, 'client-face.json');
const REAL_SERVER_PK_PATH = join(MITM_STATE_DIR, 'real-server-pubkey.txt');

const CAPTURE_ROOT = process.env['STRONGBOX_CLI_MITM_DIR'] ?? join(homedir(), 'strongbox-mitm');
const REAL_AFPROXY = process.env['STRONGBOX_CLI_MITM_REAL'] ?? '';

const HELLO_MESSAGE_LITERAL = 'message';
const HELLO_MESSAGE_TYPE = 0;

/* ─── Envelope types (local; tools/ doesn't import from src/protocol/) ── */

interface RequestEnvelope {
  clientPublicKey: string;
  nonce: string;
  message: string;
  messageType: number;
}

interface ResponseEnvelope {
  message: string;
  serverPublicKey: string;
  errorMessage: string;
  success: boolean;
  nonce: string;
}

function isRequestEnvelope(x: unknown): x is RequestEnvelope {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as Record<string, unknown>)['clientPublicKey'] === 'string' &&
    typeof (x as Record<string, unknown>)['nonce'] === 'string' &&
    typeof (x as Record<string, unknown>)['message'] === 'string' &&
    typeof (x as Record<string, unknown>)['messageType'] === 'number'
  );
}

function isResponseEnvelope(x: unknown): x is ResponseEnvelope {
  const o = x as Record<string, unknown> | null;
  return (
    !!o &&
    typeof o === 'object' &&
    typeof o['message'] === 'string' &&
    typeof o['serverPublicKey'] === 'string' &&
    typeof o['errorMessage'] === 'string' &&
    typeof o['success'] === 'boolean' &&
    typeof o['nonce'] === 'string'
  );
}

/* ─── Keypair and server-pubkey persistence ────────────────────────────── */

interface KeyPairFile {
  version: 1;
  created: string;
  publicKey: string;
  secretKey: string;
}

async function loadOrCreateKeyPair(path: string): Promise<KeyPair> {
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as KeyPairFile;
    return {
      publicKey: await fromBase64(parsed.publicKey),
      secretKey: await fromBase64(parsed.secretKey),
    };
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const kp = await generateKeyPair();
  const file: KeyPairFile = {
    version: 1,
    created: new Date().toISOString(),
    publicKey: await toBase64(kp.publicKey),
    secretKey: await toBase64(kp.secretKey),
  };
  await writeFile(path, JSON.stringify(file, null, 2), { mode: 0o600 });
  await chmod(path, 0o600);
  return kp;
}

async function loadRealServerPubKey(): Promise<Uint8Array | null> {
  try {
    const b64 = (await readFile(REAL_SERVER_PK_PATH, 'utf-8')).trim();
    return await fromBase64(b64);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function persistRealServerPubKey(pk: Uint8Array): Promise<void> {
  await mkdir(dirname(REAL_SERVER_PK_PATH), { recursive: true, mode: 0o700 });
  await writeFile(REAL_SERVER_PK_PATH, (await toBase64(pk)) + '\n', { mode: 0o644 });
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  );
}

/* ─── Main ─────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  if (!REAL_AFPROXY) {
    process.stderr.write(
      'mitm-afproxy: STRONGBOX_CLI_MITM_REAL is unset. Set it to the absolute path of the real afproxy binary.\n',
    );
    process.exit(127);
  }

  const captureDir = join(
    CAPTURE_ROOT,
    `${new Date().toISOString().replace(/[:.]/g, '').replace(/-/g, '').slice(0, 15)}Z-${process.pid}`,
  );
  await mkdir(captureDir, { recursive: true, mode: 0o755 });

  const serverFace = await loadOrCreateKeyPair(SERVER_FACE_PATH);
  const clientFace = await loadOrCreateKeyPair(CLIENT_FACE_PATH);
  let realServerPk = await loadRealServerPubKey();

  // Capture sidecar files: raw ciphertext-envelope bytes as they flow past,
  // plus a plaintext.jsonl with one record per direction-decode.
  const inBin = createWriteStream(join(captureDir, 'in.bin'));
  const outBin = createWriteStream(join(captureDir, 'out.bin'));
  const plaintextLog = createWriteStream(join(captureDir, 'plaintext.jsonl'));

  const ppid = process.ppid;
  let parentCmd = '(unknown)';
  try {
    const out = Bun.spawnSync({ cmd: ['ps', '-p', String(ppid), '-o', 'comm='] });
    parentCmd = out.stdout ? new TextDecoder().decode(out.stdout).trim() : '(ps failed)';
  } catch {
    /* leave as (unknown) */
  }
  await writeFile(
    join(captureDir, 'meta.txt'),
    [
      `date_utc=${new Date().toISOString()}`,
      `pid=${process.pid}`,
      `ppid=${ppid}`,
      `ppid_cmd=${parentCmd}`,
      `cwd=${process.cwd()}`,
      `real=${REAL_AFPROXY}`,
      `server_face_pk=${await toBase64(serverFace.publicKey)}`,
      `client_face_pk=${await toBase64(clientFace.publicKey)}`,
      `real_server_pk=${realServerPk ? await toBase64(realServerPk) : '(unknown — will be learned on first response)'}`,
      `argc=${process.argv.length - 2}`,
      ...process.argv.slice(2).map((a, i) => `argv[${i}]=${a}`),
      '',
    ].join('\n'),
  );

  const childArgs = process.argv.slice(2);
  const stderrSink = Bun.file(join(captureDir, 'stderr.log'));
  const proc = spawn({
    cmd: [REAL_AFPROXY, ...childArgs],
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: stderrSink,
  });

  const childStdin = proc.stdin as { write(chunk: Uint8Array): number; flush?(): unknown; end?(): unknown };
  const childStdout = proc.stdout as ReadableStream<Uint8Array>;

  // Chrome runs the native host one-shot per roundtrip (request → response
  // → exit), so we can treat "the browser public key this invocation is
  // about" as a single-slot latch rather than a per-request queue.
  let lastBrowserPk: Uint8Array | null = null;

  function writeToChild(env: RequestEnvelope): void {
    childStdin.write(encodeFrame(env));
    childStdin.flush?.();
  }

  function writeToBrowser(env: ResponseEnvelope): void {
    process.stdout.write(Buffer.from(encodeFrame(env)));
  }

  function logPlaintext(record: Record<string, unknown>): void {
    plaintextLog.write(JSON.stringify(record) + '\n');
  }

  async function handleBrowserToServer(raw: unknown): Promise<void> {
    if (!isRequestEnvelope(raw)) {
      throw new Error(
        `browser sent something that isn't a RequestEnvelope: ${JSON.stringify(raw).slice(0, 200)}`,
      );
    }
    lastBrowserPk = await fromBase64(raw.clientPublicKey);

    // messageType=0 is the Hello: no crypto on the request side. Substitute
    // our clientPublicKey; keep nonce="" and message="message".
    if (
      raw.messageType === HELLO_MESSAGE_TYPE &&
      raw.message === HELLO_MESSAGE_LITERAL &&
      raw.nonce === ''
    ) {
      logPlaintext({
        direction: 'c2s',
        messageType: raw.messageType,
        hello: true,
        browserClientPublicKey: raw.clientPublicKey,
      });
      writeToChild({
        clientPublicKey: await toBase64(clientFace.publicKey),
        nonce: '',
        message: HELLO_MESSAGE_LITERAL,
        messageType: HELLO_MESSAGE_TYPE,
      });
      return;
    }

    if (!realServerPk) {
      throw new Error(
        "can't forward encrypted request: real server public key is unknown. " +
          'Trigger one Hello (click the Strongbox extension icon) before the first non-Hello message.',
      );
    }

    const nonce = await fromBase64(raw.nonce);
    const ciphertext = await fromBase64(raw.message);
    const plaintext = await boxOpen({
      ciphertext,
      nonce,
      senderPublicKey: lastBrowserPk,
      recipientSecretKey: serverFace.secretKey,
    });

    logPlaintext({
      direction: 'c2s',
      messageType: raw.messageType,
      browserClientPublicKey: raw.clientPublicKey,
      browserNonceB64: raw.nonce,
      plaintextHex: Buffer.from(plaintext).toString('hex'),
      plaintextUtf8: safeUtf8(plaintext),
    });

    const outNonce = await randomNonce();
    const outCiphertext = await boxSeal({
      plaintext,
      nonce: outNonce,
      recipientPublicKey: realServerPk,
      senderSecretKey: clientFace.secretKey,
    });

    writeToChild({
      clientPublicKey: await toBase64(clientFace.publicKey),
      nonce: await toBase64(outNonce),
      message: await toBase64(outCiphertext),
      messageType: raw.messageType,
    });
  }

  async function handleServerToBrowser(raw: unknown): Promise<void> {
    if (!isResponseEnvelope(raw)) {
      throw new Error(
        `afproxy sent something that isn't a ResponseEnvelope: ${JSON.stringify(raw).slice(0, 200)}`,
      );
    }

    const serverPubFromWire = await fromBase64(raw.serverPublicKey);
    if (!realServerPk || !bytesEqual(realServerPk, serverPubFromWire)) {
      realServerPk = serverPubFromWire;
      await persistRealServerPubKey(serverPubFromWire);
    }

    const nonce = await fromBase64(raw.nonce);
    const ciphertext = await fromBase64(raw.message);
    const plaintext = await boxOpen({
      ciphertext,
      nonce,
      senderPublicKey: serverPubFromWire,
      recipientSecretKey: clientFace.secretKey,
    });

    logPlaintext({
      direction: 's2c',
      success: raw.success,
      errorMessage: raw.errorMessage,
      serverPublicKey: raw.serverPublicKey,
      serverNonceB64: raw.nonce,
      plaintextHex: Buffer.from(plaintext).toString('hex'),
      plaintextUtf8: safeUtf8(plaintext),
    });

    if (!lastBrowserPk) {
      throw new Error('got a response from afproxy before any browser request was seen');
    }

    const outNonce = await randomNonce();
    const outCiphertext = await boxSeal({
      plaintext,
      nonce: outNonce,
      recipientPublicKey: lastBrowserPk,
      senderSecretKey: serverFace.secretKey,
    });

    writeToBrowser({
      message: await toBase64(outCiphertext),
      serverPublicKey: await toBase64(serverFace.publicKey),
      errorMessage: raw.errorMessage,
      success: raw.success,
      nonce: await toBase64(outNonce),
    });
  }

  const browserPump = (async () => {
    const decoder = new FrameDecoder();
    for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
      inBin.write(chunk);
      decoder.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      for (;;) {
        const env = decoder.take();
        if (env === null) break;
        await handleBrowserToServer(env);
      }
    }
    childStdin.end?.();
  })();

  const serverPump = (async () => {
    const decoder = new FrameDecoder();
    const reader = childStdout.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      outBin.write(Buffer.from(value));
      decoder.push(value);
      for (;;) {
        const env = decoder.take();
        if (env === null) break;
        await handleServerToBrowser(env);
      }
    }
  })();

  try {
    await Promise.all([browserPump, serverPump]);
  } finally {
    inBin.end();
    outBin.end();
    plaintextLog.end();
  }

  const exitCode = await proc.exited;
  process.exit(exitCode ?? 0);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

function safeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

await main().catch((err) => {
  process.stderr.write(`mitm-afproxy: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
