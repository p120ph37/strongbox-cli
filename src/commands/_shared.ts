/**
 * Shared helpers used across the subcommand modules. Kept small on purpose;
 * if this file grows, break it up.
 */

import { Session } from '../protocol/session.ts';
import { MessageType, type Credential } from '../protocol/messages.ts';
import { setVerbose } from '../util/log.ts';
import { UserError } from '../util/errors.ts';

export interface GlobalOpts {
  json?: boolean;
  verbose?: boolean;
}

/** Apply global options that affect process-wide state (verbose logging). */
export function applyGlobalOpts(opts: GlobalOpts): void {
  setVerbose(Boolean(opts.verbose));
}

/**
 * Open a session, run a callback, and always close the session. Commander
 * subcommands should use this rather than managing sessions themselves.
 */
export async function withSession<T>(fn: (s: Session) => Promise<T>): Promise<T> {
  const session = await Session.open();
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

/**
 * mt=1 `take` requested per page. The server clamps `take` to ~64 regardless
 * of the value, so the full result set is only reachable by paging on `skip`;
 * this just keeps the round-trip count down.
 */
const PAGE_SIZE = 200;

/**
 * All entries matching an mt=1 query, paged out fully. `query: ''` returns
 * every entry in the unlocked databases. Full-text matching spans title,
 * username, notes, and custom-field values.
 *
 * Pages by advancing `skip` by the count actually returned and stops on the
 * first empty page — correct regardless of the server's internal `take` cap.
 */
export async function searchEntries(session: Session, query: string): Promise<Credential[]> {
  const all: Credential[] = [];
  for (let skip = 0; ; ) {
    const res = await session.rpc(MessageType.Search, { query, skip, take: PAGE_SIZE });
    if (res.results.length === 0) break;
    all.push(...res.results);
    skip += res.results.length;
  }
  return all;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pick the entry whose UUID or exact title equals `ref`; throw on ambiguous title. */
function matchRef(entries: readonly Credential[], ref: string): Credential | undefined {
  const byUuid = entries.find((e) => e.uuid.toLowerCase() === ref.toLowerCase());
  if (byUuid) return byUuid;
  const byTitle = entries.filter((e) => e.title === ref);
  if (byTitle.length === 1) return byTitle[0]!;
  if (byTitle.length > 1) {
    throw new UserError(
      `"${ref}" is ambiguous — ${byTitle.length} entries share that title. ` +
        `Use a UUID: ${byTitle.map((e) => e.uuid).join(', ')}`,
    );
  }
  return undefined;
}

/**
 * Resolve a user-supplied reference to exactly one entry. There is no
 * fetch-by-id RPC, so resolution goes through mt=1 search: a text search
 * matches titles/usernames/etc., and — because search does *not* index
 * UUIDs — a UUID-shaped ref falls back to a full enumeration.
 */
export async function resolveEntry(session: Session, ref: string): Promise<Credential> {
  const byText = matchRef(await searchEntries(session, ref), ref);
  if (byText) return byText;
  if (UUID_RE.test(ref)) {
    const found = (await searchEntries(session, '')).find(
      (e) => e.uuid.toLowerCase() === ref.toLowerCase(),
    );
    if (found) return found;
  }
  throw new UserError(`no entry matched "${ref}" (by UUID or exact title)`);
}

/**
 * Non-secret projection of an entry for listing/default output. Omits the
 * secret fields (`password`, `totp`, `notes`, custom-field *values*) and the
 * bulky `icon`; those are reachable only through an explicit `get --field`.
 */
export function publicView(c: Credential): Record<string, unknown> {
  return {
    uuid: c.uuid,
    title: c.title,
    username: c.username,
    url: c.url,
    databaseName: c.databaseName,
    favourite: c.favourite,
    tags: c.tags,
    attachmentFileNames: c.attachmentFileNames,
    customFields: c.customFields.map((f) => ({ key: f.key, concealable: f.concealable })),
    hasTotp: c.totp.length > 0,
    modified: c.modified,
  };
}

/**
 * Full projection including the fields `publicView` hides — `password`, the
 * `totp` otpauth URI, `notes`, and custom-field *values*. For `get --reveal`,
 * an explicit "show everything" request. Omits `icon` (a bulky display asset,
 * not credential data); `get --icon` or `get --field icon` retrieve it.
 */
export function fullView(c: Credential): Record<string, unknown> {
  return {
    uuid: c.uuid,
    databaseId: c.databaseId,
    databaseName: c.databaseName,
    title: c.title,
    username: c.username,
    password: c.password,
    url: c.url,
    totp: c.totp,
    notes: c.notes,
    favourite: c.favourite,
    tags: c.tags,
    customFields: c.customFields,
    attachmentFileNames: c.attachmentFileNames,
    modified: c.modified,
  };
}

/**
 * Emit output honoring --json. Scalars and structured objects are handled
 * differently so that shell pipelines work cleanly in the default mode.
 */
export function emit(value: unknown, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
    return;
  }
  if (typeof value === 'string') {
    process.stdout.write(value);
    if (!value.endsWith('\n')) process.stdout.write('\n');
    return;
  }
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}
