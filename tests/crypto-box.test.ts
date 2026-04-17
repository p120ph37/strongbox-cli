import { describe, expect, test } from 'bun:test';
import {
  generateKeyPair,
  open,
  randomNonce,
  seal,
  fromBase64,
  toBase64,
  MAC_BYTES,
  NONCE_BYTES,
  PUBLIC_KEY_BYTES,
  SECRET_KEY_BYTES,
} from '../src/crypto/box.ts';

describe('crypto/box', () => {
  test('generates keypairs of the expected size', async () => {
    const kp = await generateKeyPair();
    expect(kp.publicKey.byteLength).toBe(PUBLIC_KEY_BYTES);
    expect(kp.secretKey.byteLength).toBe(SECRET_KEY_BYTES);
  });

  test('seal / open roundtrip', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const nonce = await randomNonce();
    expect(nonce.byteLength).toBe(NONCE_BYTES);

    const plaintext = new TextEncoder().encode('hello, strongbox');
    const ciphertext = await seal({
      plaintext,
      nonce,
      recipientPublicKey: bob.publicKey,
      senderSecretKey: alice.secretKey,
    });
    expect(ciphertext.byteLength).toBe(plaintext.byteLength + MAC_BYTES);

    const decrypted = await open({
      ciphertext,
      nonce,
      senderPublicKey: alice.publicKey,
      recipientSecretKey: bob.secretKey,
    });
    expect(new TextDecoder().decode(decrypted)).toBe('hello, strongbox');
  });

  test('open rejects tampered ciphertext', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const nonce = await randomNonce();

    const plaintext = new TextEncoder().encode('don\'t touch this');
    const ciphertext = await seal({
      plaintext,
      nonce,
      recipientPublicKey: bob.publicKey,
      senderSecretKey: alice.secretKey,
    });
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0x01; // flip one bit

    await expect(
      open({
        ciphertext,
        nonce,
        senderPublicKey: alice.publicKey,
        recipientSecretKey: bob.secretKey,
      }),
    ).rejects.toThrow();
  });

  test('base64 helpers are symmetric', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
    const b64 = await toBase64(bytes);
    const back = await fromBase64(b64);
    expect(back).toEqual(bytes);
  });
});
