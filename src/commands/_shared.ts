/**
 * Shared helpers used across the subcommand modules. Kept small on purpose;
 * if this file grows, break it up.
 */

import { Session } from '../protocol/session.ts';
import { MessageType, type Credential, type DatabaseSummary } from '../protocol/messages.ts';
import { setVerbose, trace } from '../util/log.ts';
import { NotRunningError, UserError } from '../util/errors.ts';

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
 *
 * `databaseId` restricts the candidates to one database, so a title shared
 * across vaults stops being ambiguous.
 */
export async function resolveEntry(
  session: Session,
  ref: string,
  databaseId?: string,
): Promise<Credential> {
  const inDb = (entries: readonly Credential[]): readonly Credential[] =>
    databaseId === undefined ? entries : entries.filter((e) => e.databaseId === databaseId);

  const byText = matchRef(inDb(await searchEntries(session, ref)), ref);
  if (byText) return byText;
  if (UUID_RE.test(ref)) {
    const found = inDb(await searchEntries(session, '')).find(
      (e) => e.uuid.toLowerCase() === ref.toLowerCase(),
    );
    if (found) return found;
  }
  throw new UserError(
    `no entry matched "${ref}" (by UUID or exact title)` +
      (databaseId === undefined ? '' : ' in that database'),
  );
}

/** Find a database by nickname or UUID, in any lock state. Throws if there is none. */
export function requireDatabase(dbs: readonly DatabaseSummary[], ref: string): DatabaseSummary {
  const db = dbs.find((d) => d.nickName === ref || d.uuid.toLowerCase() === ref.toLowerCase());
  if (!db) {
    throw new UserError(
      `no database matched "${ref}" (have: ${dbs.map((d) => d.nickName).join(', ')})`,
    );
  }
  return db;
}

/**
 * Pick a database from the Hello summary. A ref matches nickname or UUID;
 * with no ref, the sole unlocked database is used.
 *
 * A locked database is a hard error rather than an empty result: entry queries
 * (mt=1/2/14) silently exclude locked databases, so without this check naming a
 * locked vault looks identical to naming an empty one.
 */
export function resolveDatabase(
  dbs: readonly DatabaseSummary[],
  ref: string | undefined,
): DatabaseSummary {
  if (ref) {
    const m = requireDatabase(dbs, ref);
    if (m.locked) {
      throw new NotRunningError(
        `database "${ref}" is locked — unlock it in Strongbox first (or pass --unlock)`,
      );
    }
    return m;
  }
  const unlocked = dbs.filter((d) => !d.locked);
  if (unlocked.length === 1) return unlocked[0]!;
  if (unlocked.length === 0) throw new NotRunningError('no unlocked database');
  throw new UserError(
    `multiple unlocked databases — pass --database (${unlocked.map((d) => d.nickName).join(', ')})`,
  );
}

/**
 * mt=5 blocks until the user finishes (or cancels) Strongbox's master-password
 * / biometric prompt, so it needs a far longer deadline than a query. The cap
 * exists only so a prompt nobody is watching can't hang the CLI forever.
 */
const UNLOCK_TIMEOUT_MS = 5 * 60_000;

/**
 * Ask Strongbox to unlock a database (mt=5), which raises its own prompt, and
 * report whether the vault actually ended up unlocked.
 *
 * mt=5 does not return until the prompt resolves, and its ack carries the
 * outcome: `{success: false}` for a cancelled prompt, `{success: true}` once
 * unlocked (both confirmed 2026-08-13 — PROTOCOL.md §5.4).
 */
export async function unlockDatabase(session: Session, db: DatabaseSummary): Promise<boolean> {
  const ack = await session.rpc(
    MessageType.UnlockDatabase,
    { databaseId: db.uuid },
    UNLOCK_TIMEOUT_MS,
  );
  trace('unlock ack:', JSON.stringify(ack));
  return ack.success;
}

/**
 * Resolve a `--database` ref for a query command. `undefined` means "no
 * restriction". With `unlock`, a locked target is prompted for rather than
 * rejected — and a declined prompt still fails, because the query behind it
 * would silently return nothing.
 */
export async function scopeDatabase(
  session: Session,
  ref: string | undefined,
  unlock = false,
): Promise<DatabaseSummary | undefined> {
  if (ref === undefined) return undefined;
  const { databases } = await session.rpc(MessageType.Hello, {});
  if (!unlock) return resolveDatabase(databases, ref);

  const db = requireDatabase(databases, ref);
  if (db.locked && !(await unlockDatabase(session, db))) {
    throw new NotRunningError(`database "${ref}" was not unlocked (prompt cancelled or failed)`);
  }
  return db;
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
