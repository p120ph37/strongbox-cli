/**
 * A higher-level session object that commands use.
 *
 * Responsibilities:
 *   - discover the manifest
 *   - load or create the persistent client identity
 *   - exchange keys via the Hello envelope (docs/PROTOCOL.md §4.2)
 *   - encrypt outgoing RPCs, decrypt incoming responses
 *
 * Note there is no persistent connection to hold onto: afproxy is spawned
 * per message and exits after replying (docs/PROTOCOL.md §4.1), so a
 * "session" is really just the manifest plus the two public keys needed to
 * encrypt the next one-shot round-trip.
 */

import { readFile } from 'node:fs/promises';
import { Afproxy } from '../transport/afproxy.ts';
import { pickStrongboxManifest, type NativeMessagingManifest } from '../transport/manifest.ts';
import { loadOrCreateIdentity, type Identity } from '../crypto/identity.ts';
import { fromBase64, open as boxOpen, randomNonce, seal, toBase64 } from '../crypto/box.ts';
import {
  EnvironmentError,
  HandshakeError,
  NotRunningError,
  ProtocolError,
  TransportError,
} from '../util/errors.ts';
import { trace } from '../util/log.ts';
import {
  MessageType,
  type HelloResponse,
  type MessageTypeValue,
  type RequestEnvelope,
  type ResponseEnvelope,
  type RpcRequestFor,
  type RpcResponseFor,
} from './messages.ts';
import { isResponseEnvelope, isRpcResponseFor } from './guards.ts';

export interface SessionOptions {
  /** Override the binary path. Primarily for tests. */
  manifestPathOverride?: string;
}

export class Session {
  private constructor(
    readonly identity: Identity,
    private readonly manifest: NativeMessagingManifest,
    private readonly peerPublicKey: Uint8Array,
    /** Hello response from key exchange; reused so `rpc(Hello)` costs nothing. */
    private readonly hello: HelloResponse,
  ) {}

  static async open(opts: SessionOptions = {}): Promise<Session> {
    const manifest = opts.manifestPathOverride
      ? await readManifest(opts.manifestPathOverride)
      : await pickStrongboxManifest();
    if (!manifest) {
      throw new EnvironmentError(
        'no Strongbox Native Messaging manifest found. Is Strongbox Pro installed and is ' +
          'the browser-autofill extension enabled?',
      );
    }
    trace('using manifest:', manifest.manifestPath);

    const identity = await loadOrCreateIdentity();

    // messageType=0 doubles as key exchange: the request carries no
    // ciphertext (nonce empty, message the literal "message"), and the reply
    // hands us the server's long-lived public key. See PROTOCOL.md §4.2.
    const res = await roundtrip(manifest, {
      clientPublicKey: await toBase64(identity.keyPair.publicKey),
      nonce: '',
      message: 'message',
      messageType: MessageType.Hello,
    });
    if (!res.success) {
      throw new HandshakeError(res.errorMessage || 'Strongbox rejected the Hello envelope');
    }

    const peerPublicKey = await fromBase64(res.serverPublicKey);
    const hello = await decryptPayload(MessageType.Hello, res, identity, peerPublicKey);
    trace('handshake complete; Strongbox', hello.serverVersionInfo);
    return new Session(identity, manifest, peerPublicKey, hello);
  }

  /** Send an encrypted RPC and await the decrypted, shape-checked response. */
  async rpc<K extends MessageTypeValue>(
    messageType: K,
    request: RpcRequestFor<K>,
  ): Promise<RpcResponseFor<K>> {
    if (messageType === MessageType.Hello) {
      return this.hello as RpcResponseFor<K>;
    }

    const nonce = await randomNonce();
    const ciphertext = await seal({
      plaintext: new TextEncoder().encode(JSON.stringify(request)),
      nonce,
      recipientPublicKey: this.peerPublicKey,
      senderSecretKey: this.identity.keyPair.secretKey,
    });

    const res = await roundtrip(this.manifest, {
      clientPublicKey: await toBase64(this.identity.keyPair.publicKey),
      nonce: await toBase64(nonce),
      message: await toBase64(ciphertext),
      messageType,
    });
    if (!res.success) {
      throw new ProtocolError(res.errorMessage || `Strongbox rejected messageType ${messageType}`);
    }
    return decryptPayload(messageType, res, this.identity, this.peerPublicKey);
  }

  /** No-op: each RPC owns its afproxy process and closes it. Kept for callers. */
  async close(): Promise<void> {}
}

/** Load a specific manifest instead of scanning the browser directories. */
async function readManifest(path: string): Promise<NativeMessagingManifest> {
  try {
    const data = JSON.parse(await readFile(path, 'utf-8')) as NativeMessagingManifest['data'];
    return { manifestPath: path, browser: 'chromium', data };
  } catch (err) {
    throw new EnvironmentError(
      `could not read manifest at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * One afproxy spawn, one request, one response. The host exits after
 * replying, so there is nothing to reuse between calls.
 */
async function roundtrip(
  manifest: NativeMessagingManifest,
  request: RequestEnvelope,
): Promise<ResponseEnvelope> {
  let proc: Afproxy;
  try {
    proc = await Afproxy.spawn({ manifest });
  } catch (err) {
    throw new NotRunningError(
      `failed to spawn afproxy at ${manifest.data.path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    const raw = await withTimeout(proc.roundtrip(request), RPC_TIMEOUT_MS);
    if (!isResponseEnvelope(raw)) {
      throw new ProtocolError(`malformed response envelope: ${JSON.stringify(raw).slice(0, 200)}`);
    }
    return raw;
  } finally {
    await proc.close();
  }
}

/**
 * afproxy answers in well under a second when Strongbox is healthy, but it can
 * connect and then never reply — observed when Strongbox declines to serve the
 * peer (see docs/PROTOCOL.md §3.1). Without a deadline the CLI hangs forever.
 */
const RPC_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TransportError(`afproxy did not reply within ${ms}ms`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new TransportError(String(e)));
      },
    );
  });
}

/** Decrypt an envelope's `message` and validate it against the RPC's shape. */
async function decryptPayload<K extends MessageTypeValue>(
  messageType: K,
  res: ResponseEnvelope,
  identity: Identity,
  peerPublicKey: Uint8Array,
): Promise<RpcResponseFor<K>> {
  let plaintext: Uint8Array;
  try {
    plaintext = await boxOpen({
      ciphertext: await fromBase64(res.message),
      nonce: await fromBase64(res.nonce),
      senderPublicKey: peerPublicKey,
      recipientSecretKey: identity.keyPair.secretKey,
    });
  } catch (err) {
    throw new ProtocolError(
      `could not decrypt the messageType ${messageType} response: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new ProtocolError(`messageType ${messageType} response plaintext is not JSON`);
  }
  if (!isRpcResponseFor(messageType, payload)) {
    throw new ProtocolError(`messageType ${messageType} response did not match the expected shape`);
  }
  return payload;
}
