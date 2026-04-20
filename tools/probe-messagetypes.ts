#!/usr/bin/env bun
/**
 * Synthetic probe for undocumented messageType slots.
 *
 * Fires one encrypted RequestEnvelope per target messageType carrying
 * a minimal `{}` plaintext payload, and records the server's response.
 * The goal is to elicit descriptive error messages that hint at the
 * operation name, required arguments, or schema.
 *
 * Reuses the MitM's client-face keypair (already TOFU-trusted with
 * Strongbox) and the real server public key learned during the
 * Layer-D.1 capture session. Neither is regenerated here.
 *
 * Results are appended as JSONL to
 *   docs/captures/<YYYY-MM-DD>-probes/probes.jsonl
 * one record per probe, including the raw envelope fields, the decoded
 * inner plaintext (if the server encrypted a response at all), and any
 * stderr afproxy emitted.
 *
 * Prereqs:
 *   - Strongbox running, at least one DB unlocked (some ops may fail
 *     early with "db locked" before reaching the dispatch table).
 *   - A previous successful Layer-D.1 session (so client-face.json and
 *     real-server-pubkey.txt exist under the MitM state dir).
 *   - STRONGBOX_CLI_MITM_REAL exported, OR the default afproxy path
 *     below still matches the installed Strongbox.
 */

import { spawn } from 'bun';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { FrameDecoder, encodeFrame } from '../src/transport/native-messaging.ts';
import {
  fromBase64,
  open as boxOpen,
  randomNonce,
  seal as boxSeal,
  toBase64,
  type KeyPair,
} from '../src/crypto/box.ts';

/* ─── Configuration ───────────────────────────────────────────────────── */

const MITM_STATE_DIR = join(homedir(), 'Library', 'Application Support', 'strongbox-cli-mitm');
const CLIENT_FACE_PATH = join(MITM_STATE_DIR, 'client-face.json');
const REAL_SERVER_PK_PATH = join(MITM_STATE_DIR, 'real-server-pubkey.txt');

const AFPROXY =
  process.env['STRONGBOX_CLI_MITM_REAL'] ??
  '/Applications/Strongbox.app/Contents/MacOS/afproxy';
const CHROME_EXT_ORIGIN = 'chrome-extension://mnilpkfepdibngheginihjpknnopchbn/';

// Sweep the entire low-messageType range plus a high probe. mt=0 is
// Hello and has a different wire format (no crypto_box), so it's
// skipped — its class name isn't needed.
const PROBE_TYPES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 100];

// Each plaintext is tried against each messageType. `[]` is valid JSON
// but can't decode into any request object, which forces Strongbox to
// emit the "Can't decode <ClassName> from message JSON" error for every
// dispatched slot — including ones that would otherwise accept `{}` and
// never name themselves (mt=9, mt=14).
const PROBE_PLAINTEXTS: Array<{ label: string; plaintext: string }> = [
  { label: 'empty-object', plaintext: '{}' },
  { label: 'empty-array', plaintext: '[]' },
];

const PROBE_TIMEOUT_MS = 5_000;

/* ─── Types ───────────────────────────────────────────────────────────── */

interface ClientKeyFile {
  publicKey: string;
  secretKey: string;
}

interface ResponseEnvelope {
  message: string;
  serverPublicKey: string;
  errorMessage: string;
  success: boolean;
  nonce: string;
}

interface ProbeResult {
  messageType: number;
  probeLabel: string;
  probePlaintext: string;
  rawResponse: ResponseEnvelope | null;
  plaintextUtf8: string | null;
  plaintextDecryptError: string | null;
  stderr: string;
  transportError: string | null;
}

/* ─── Key material loading ────────────────────────────────────────────── */

async function loadClientFace(): Promise<KeyPair> {
  const raw = await readFile(CLIENT_FACE_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as ClientKeyFile;
  return {
    publicKey: await fromBase64(parsed.publicKey),
    secretKey: await fromBase64(parsed.secretKey),
  };
}

async function loadServerPk(): Promise<Uint8Array> {
  const b64 = (await readFile(REAL_SERVER_PK_PATH, 'utf-8')).trim();
  return fromBase64(b64);
}

/* ─── Probe ───────────────────────────────────────────────────────────── */

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

async function probe(
  messageType: number,
  probeLabel: string,
  probePlaintext: string,
  client: KeyPair,
  serverPk: Uint8Array,
): Promise<ProbeResult> {
  const result: ProbeResult = {
    messageType,
    probeLabel,
    probePlaintext,
    rawResponse: null,
    plaintextUtf8: null,
    plaintextDecryptError: null,
    stderr: '',
    transportError: null,
  };

  const proc = spawn({
    cmd: [AFPROXY, CHROME_EXT_ORIGIN],
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const writer = proc.stdin as {
    write(chunk: Uint8Array): number;
    flush?(): unknown;
    end?(): unknown;
  };

  try {
    const nonce = await randomNonce();
    const ciphertext = await boxSeal({
      plaintext: new TextEncoder().encode(probePlaintext),
      nonce,
      recipientPublicKey: serverPk,
      senderSecretKey: client.secretKey,
    });

    const envelope = {
      clientPublicKey: await toBase64(client.publicKey),
      nonce: await toBase64(nonce),
      message: await toBase64(ciphertext),
      messageType,
    };

    writer.write(encodeFrame(envelope));
    writer.flush?.();
    writer.end?.();

    const decoder = new FrameDecoder();
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('probe timeout')), PROBE_TIMEOUT_MS),
    );

    const readResponse = (async (): Promise<unknown> => {
      for (;;) {
        const env = decoder.take();
        if (env !== null) return env;
        const { value, done } = await reader.read();
        if (done) return null;
        decoder.push(value);
      }
    })();

    const raw = await Promise.race([readResponse, timeout]);

    if (!isResponseEnvelope(raw)) {
      result.transportError =
        raw === null
          ? 'afproxy closed stdout before a frame was read'
          : `unexpected response shape: ${JSON.stringify(raw).slice(0, 200)}`;
    } else {
      result.rawResponse = raw;
      if (raw.message.length > 0) {
        try {
          const respCiphertext = await fromBase64(raw.message);
          const respNonce = await fromBase64(raw.nonce);
          const respServerPk = await fromBase64(raw.serverPublicKey);
          const respPlain = await boxOpen({
            ciphertext: respCiphertext,
            nonce: respNonce,
            senderPublicKey: respServerPk,
            recipientSecretKey: client.secretKey,
          });
          try {
            result.plaintextUtf8 = new TextDecoder('utf-8', { fatal: true }).decode(respPlain);
          } catch {
            result.plaintextUtf8 = null;
            result.plaintextDecryptError = 'plaintext was not valid utf-8';
          }
        } catch (err) {
          result.plaintextDecryptError = err instanceof Error ? err.message : String(err);
        }
      }
    }
  } catch (err) {
    result.transportError = err instanceof Error ? err.message : String(err);
  } finally {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
    const stderrBuf = await new Response(proc.stderr as ReadableStream<Uint8Array>).text();
    result.stderr = stderrBuf;
    await proc.exited;
  }

  return result;
}

/* ─── Main ────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const client = await loadClientFace();
  const serverPk = await loadServerPk();

  const today = new Date().toISOString().slice(0, 10);
  const outDir = join(process.cwd(), 'docs', 'captures', `${today}-probes`);
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, 'probes.jsonl');
  const lines: string[] = [];

  for (const { label, plaintext } of PROBE_PLAINTEXTS) {
    process.stderr.write(`\n── payload: ${label} (${JSON.stringify(plaintext)}) ──\n`);
    for (const mt of PROBE_TYPES) {
      process.stderr.write(`  mt=${String(mt).padStart(3)} `);
      const r = await probe(mt, label, plaintext, client, serverPk);
      lines.push(JSON.stringify(r));
      const summary = r.transportError
        ? `TRANSPORT_ERR: ${r.transportError}`
        : `success=${String(r.rawResponse?.success ?? '?')} err=${JSON.stringify(r.rawResponse?.errorMessage ?? '?')}`;
      process.stderr.write(`${summary}\n`);
    }
  }

  await writeFile(outPath, lines.join('\n') + '\n');
  process.stderr.write(`\nwrote ${lines.length} probe results to ${outPath}\n`);
}

await main().catch((err) => {
  process.stderr.write(
    `probe-messagetypes: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
