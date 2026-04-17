/**
 * Thin typed wrapper around libsodium's Crypto Box primitive.
 *
 * Strongbox's public KB article states that traffic is encrypted with a
 * "Crypto Box or Secret Key Box" using ephemeral public/private key pairs.
 * That language maps to libsodium's `crypto_box_easy` family:
 *   - Curve25519 key agreement
 *   - XSalsa20 stream cipher
 *   - Poly1305 MAC
 *   - 32-byte public and secret keys
 *   - 24-byte nonce
 *   - 16-byte MAC appended to ciphertext
 *
 * Whether the handshake uses the combined `crypto_box_easy` call or the split
 * `crypto_kx` (key-exchange) + `crypto_secretbox` construction is something
 * the wire captures (see docs/REVERSE_ENGINEERING.md, Layer D) will tell us.
 * The two alternatives share this keypair type, so choosing between them
 * later is a drop-in change.
 *
 * Reference: https://doc.libsodium.org/public-key_cryptography/authenticated_encryption
 */

/**
 * NOTE: libsodium-wrappers-sumo@0.7.16 ships a broken ESM bundle whose
 * internal specifier `./libsodium-sumo.mjs` references a file that's not
 * included in the package's `files` list.  Bun's strict ESM loader (and
 * Node's, in theory) reject the import.  The CJS bundle in the same package
 * is complete and works fine, so we resolve it via createRequire.  If/when
 * upstream fixes the ESM build, this can become a plain `import sodium from
 * 'libsodium-wrappers-sumo'`.
 */
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const sodium = require_('libsodium-wrappers-sumo') as typeof import('libsodium-wrappers-sumo');

export const PUBLIC_KEY_BYTES = 32;
export const SECRET_KEY_BYTES = 32;
export const NONCE_BYTES = 24;
export const MAC_BYTES = 16;

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

let ready = false;
async function ensureReady(): Promise<void> {
  if (ready) return;
  await sodium.ready;
  ready = true;
}

/** Generate a fresh Curve25519 keypair. */
export async function generateKeyPair(): Promise<KeyPair> {
  await ensureReady();
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, secretKey: kp.privateKey };
}

/** Generate a fresh 24-byte nonce from the CSPRNG. */
export async function randomNonce(): Promise<Uint8Array> {
  await ensureReady();
  return sodium.randombytes_buf(NONCE_BYTES);
}

/** Seal `plaintext` with `crypto_box_easy`. Output is `plaintext.length + MAC_BYTES` bytes. */
export async function seal(args: {
  plaintext: Uint8Array;
  nonce: Uint8Array;
  recipientPublicKey: Uint8Array;
  senderSecretKey: Uint8Array;
}): Promise<Uint8Array> {
  await ensureReady();
  assertLen(args.nonce, NONCE_BYTES, 'nonce');
  assertLen(args.recipientPublicKey, PUBLIC_KEY_BYTES, 'recipientPublicKey');
  assertLen(args.senderSecretKey, SECRET_KEY_BYTES, 'senderSecretKey');
  return sodium.crypto_box_easy(
    args.plaintext,
    args.nonce,
    args.recipientPublicKey,
    args.senderSecretKey,
  );
}

/** Open a `crypto_box_easy` ciphertext. Throws if the MAC does not verify. */
export async function open(args: {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  senderPublicKey: Uint8Array;
  recipientSecretKey: Uint8Array;
}): Promise<Uint8Array> {
  await ensureReady();
  assertLen(args.nonce, NONCE_BYTES, 'nonce');
  assertLen(args.senderPublicKey, PUBLIC_KEY_BYTES, 'senderPublicKey');
  assertLen(args.recipientSecretKey, SECRET_KEY_BYTES, 'recipientSecretKey');
  if (args.ciphertext.byteLength < MAC_BYTES) {
    throw new Error(`ciphertext is ${args.ciphertext.byteLength} bytes; minimum is ${MAC_BYTES}`);
  }
  return sodium.crypto_box_open_easy(
    args.ciphertext,
    args.nonce,
    args.senderPublicKey,
    args.recipientSecretKey,
  );
}

/** Base64 helpers; Strongbox's extension almost certainly uses base64 for key transport. */
export async function toBase64(bytes: Uint8Array): Promise<string> {
  await ensureReady();
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

export async function fromBase64(s: string): Promise<Uint8Array> {
  await ensureReady();
  return sodium.from_base64(s, sodium.base64_variants.ORIGINAL);
}

function assertLen(buf: Uint8Array, want: number, name: string): void {
  if (buf.byteLength !== want) {
    throw new Error(`${name} must be ${want} bytes; got ${buf.byteLength}`);
  }
}
