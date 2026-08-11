/**
 * A stand-in for Strongbox's afproxy that speaks the envelope protocol
 * documented in docs/PROTOCOL.md §4. Used by tests/session.test.ts so the
 * crypto + envelope path can be exercised without Strongbox installed.
 *
 * Like the real host it is one-shot: read one frame, reply, exit. Its
 * keypair is read from STRONGBOX_CLI_FAKE_SK/PK so the test can decrypt.
 */

import { encodeFrame, FrameDecoder } from '../../src/transport/native-messaging.ts';
import { fromBase64, open, randomNonce, seal, toBase64 } from '../../src/crypto/box.ts';
import { MessageType } from '../../src/protocol/messages.ts';

const HELLO = {
  serverVersionInfo: '1.63.1',
  databases: [
    {
      uuid: 'CF248F0B-159A-41B0-B90F-F57FE0D1B5EA',
      nickName: 'test',
      locked: false,
      autoFillEnabled: true,
      includeFavIconForNewEntries: true,
    },
  ],
  serverSettings: {
    colorBlindPalette: false,
    supportsCreateNew: true,
    markdownNotes: true,
    colorizePasswords: true,
  },
};

const secretKey = await fromBase64(process.env['STRONGBOX_CLI_FAKE_SK'] ?? '');
const publicKey = await fromBase64(process.env['STRONGBOX_CLI_FAKE_PK'] ?? '');

// Read exactly one frame from stdin.
const decoder = new FrameDecoder();
let request: unknown = null;
for await (const chunk of Bun.stdin.stream()) {
  decoder.push(chunk);
  request = decoder.take();
  if (request !== null) break;
}

const req = request as Record<string, string | number>;
const clientPublicKey = await fromBase64(String(req['clientPublicKey']));

let payload: unknown;
if (req['messageType'] === MessageType.Hello) {
  payload = HELLO;
} else {
  const inner = JSON.parse(
    new TextDecoder().decode(
      await open({
        ciphertext: await fromBase64(String(req['message'])),
        nonce: await fromBase64(String(req['nonce'])),
        senderPublicKey: clientPublicKey,
        recipientSecretKey: secretKey,
      }),
    ),
  ) as { url?: string };
  // Echo the URL back so the test can prove the request survived the round-trip.
  payload = { results: [], unlockedDatabaseCount: inner.url === 'https://example.com/' ? 7 : 0 };
}

const nonce = await randomNonce();
process.stdout.write(
  encodeFrame({
    message: await toBase64(
      await seal({
        plaintext: new TextEncoder().encode(JSON.stringify(payload)),
        nonce,
        recipientPublicKey: clientPublicKey,
        senderSecretKey: secretKey,
      }),
    ),
    serverPublicKey: await toBase64(publicKey),
    errorMessage: '',
    success: true,
    nonce: await toBase64(nonce),
  }),
);
