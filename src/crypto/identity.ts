/**
 * Client identity persistence.
 *
 * The most plausible handshake model (to be confirmed by capture; see
 * docs/PROTOCOL.md §4.1) is trust-on-first-use: we generate a keypair once,
 * show it to Strongbox the first time we connect, the user approves us in
 * the Strongbox UI, and subsequent sessions skip the prompt because
 * Strongbox has remembered our public key.
 *
 * For that to work, *our* private key has to persist across invocations.
 * This module owns that persistence.
 *
 * File layout:
 *
 *   ~/Library/Application Support/strongbox-cli/identity.json
 *
 *   {
 *     "version": 1,
 *     "created": "2026-04-17T…Z",
 *     "publicKey":  "<base64 of 32 bytes>",
 *     "secretKey":  "<base64 of 32 bytes>"
 *   }
 *
 * The file is written with mode 0600. The containing directory is created
 * with mode 0700 if it doesn't already exist.
 */

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateKeyPair, fromBase64, toBase64, type KeyPair } from './box.ts';
import { EnvironmentError } from '../util/errors.ts';
import { trace } from '../util/log.ts';

export const IDENTITY_PATH = join(
  homedir(),
  'Library',
  'Application Support',
  'strongbox-cli',
  'identity.json',
);

interface IdentityFile {
  version: 1;
  created: string;
  publicKey: string;
  secretKey: string;
}

export interface Identity {
  keyPair: KeyPair;
  createdAt: Date;
  path: string;
}

/**
 * Load the client identity, creating it if it doesn't exist.
 *
 * If the file is present but unparseable, we throw rather than silently
 * replace it — a corrupt identity is something the user should know about
 * because it forces a re-authorisation in Strongbox.
 */
export async function loadOrCreateIdentity(): Promise<Identity> {
  try {
    const raw = await readFile(IDENTITY_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as IdentityFile;
    if (parsed.version !== 1) {
      throw new EnvironmentError(
        `identity file at ${IDENTITY_PATH} has unsupported version ${String(parsed.version)}`,
      );
    }
    const keyPair: KeyPair = {
      publicKey: await fromBase64(parsed.publicKey),
      secretKey: await fromBase64(parsed.secretKey),
    };
    trace('loaded identity:', IDENTITY_PATH);
    return { keyPair, createdAt: new Date(parsed.created), path: IDENTITY_PATH };
  } catch (err) {
    if (!isNotFound(err)) {
      if (err instanceof EnvironmentError) throw err;
      throw new EnvironmentError(
        `failed to read identity at ${IDENTITY_PATH}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return createIdentity();
}

/** Force-create a new identity, replacing any existing one. */
export async function createIdentity(): Promise<Identity> {
  await mkdir(dirname(IDENTITY_PATH), { recursive: true, mode: 0o700 });
  const kp = await generateKeyPair();
  const now = new Date();
  const file: IdentityFile = {
    version: 1,
    created: now.toISOString(),
    publicKey: await toBase64(kp.publicKey),
    secretKey: await toBase64(kp.secretKey),
  };
  await writeFile(IDENTITY_PATH, JSON.stringify(file, null, 2), { mode: 0o600 });
  // writeFile's `mode` isn't always honoured on existing files; enforce it.
  await chmod(IDENTITY_PATH, 0o600);
  trace('created new identity:', IDENTITY_PATH);
  return { keyPair: kp, createdAt: now, path: IDENTITY_PATH };
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  );
}
