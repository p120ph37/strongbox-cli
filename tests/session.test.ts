/**
 * Exercises the full envelope path — Hello key exchange, crypto_box seal /
 * open, guard validation — against the fake afproxy in tests/fixtures/.
 * Proves the wire format in docs/PROTOCOL.md §4 is implemented correctly
 * without needing Strongbox installed.
 */

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, toBase64 } from '../src/crypto/box.ts';
import { MessageType, type CredentialsForUrlResponse } from '../src/protocol/messages.ts';
import { isRpcResponseFor } from '../src/protocol/guards.ts';
import { Session } from '../src/protocol/session.ts';

let dir: string;
let manifestPath: string;

beforeAll(async () => {
  const kp = await generateKeyPair();

  dir = await mkdtemp(join(tmpdir(), 'strongbox-cli-test-'));
  // Native Messaging hosts are executables, so wrap the fixture in a shell
  // script. The throwaway keypair is baked into the wrapper because Bun does
  // not propagate runtime `process.env` mutations to spawned children.
  const host = join(dir, 'fake-afproxy.sh');
  const fixture = join(import.meta.dir, 'fixtures', 'fake-afproxy.ts');
  await writeFile(
    host,
    '#!/bin/sh\n' +
      `STRONGBOX_CLI_FAKE_SK='${await toBase64(kp.secretKey)}' \\\n` +
      `STRONGBOX_CLI_FAKE_PK='${await toBase64(kp.publicKey)}' \\\n` +
      `exec ${process.execPath} run ${fixture}\n`,
  );
  await chmod(host, 0o700);

  manifestPath = join(dir, 'manifest.json');
  await writeFile(
    manifestPath,
    JSON.stringify({ name: 'com.markmcguill.strongbox', path: host, type: 'stdio' }),
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('Hello exchanges keys and returns the database list', async () => {
  const session = await Session.open({ manifestPathOverride: manifestPath });
  const hello = await session.rpc(MessageType.Hello, {});
  expect(hello.serverVersionInfo).toBe('1.63.1');
  expect(hello.databases[0]?.nickName).toBe('test');
  await session.close();
});

// Guards are only worth anything if they accept the traffic we actually
// observed. Replaying the committed captures catches a guard tightened past
// what the real server sends.
test.each([
  ['10-mt2-results-two', 2],
  ['11-mt2-results-paginated', 0],
  ['12-mt2-results-three', 3],
])('%s replays through the CredentialsForUrl guard', async (dir, want) => {
  const path = join(
    import.meta.dir,
    '..',
    'docs',
    'captures',
    '2026-04-20-layerD',
    dir,
    'plaintext.jsonl',
  );
  const reply = (await Bun.file(path).text())
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { direction: string; plaintextUtf8?: string })
    .find((e) => e.direction === 's2c');

  const payload: unknown = JSON.parse(reply?.plaintextUtf8 ?? '');
  expect(isRpcResponseFor(MessageType.CredentialsForUrl, payload)).toBe(true);
  // Narrowed by the guard above, so this is the guard's own view of the data.
  expect((payload as CredentialsForUrlResponse).results).toHaveLength(want);
});

test('an encrypted RPC round-trips its payload', async () => {
  const session = await Session.open({ manifestPathOverride: manifestPath });
  const res = await session.rpc(MessageType.CredentialsForUrl, {
    url: 'https://example.com/',
    skip: 0,
    take: 9,
  });
  // The fixture only returns 7 if it decrypted our URL correctly.
  expect(res.unlockedDatabaseCount).toBe(7);
  await session.close();
});
