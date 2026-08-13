/**
 * Entry/database resolution: the `--database` scoping and the locked-vault
 * guard. Locked databases are silently absent from mt=1 results (PROTOCOL.md
 * §5.1), so "locked" must not be reported as "no such entry".
 */

import { expect, test } from 'bun:test';
import { resolveDatabase, resolveEntry, scopeDatabase } from '../src/commands/_shared.ts';
import {
  MessageType,
  type Credential,
  type DatabaseSummary,
  type SearchRequest,
} from '../src/protocol/messages.ts';
import type { Session } from '../src/protocol/session.ts';
import { NotRunningError, UserError } from '../src/util/errors.ts';

const db = (nickName: string, uuid: string, locked: boolean): DatabaseSummary => ({
  uuid,
  nickName,
  locked,
  autoFillEnabled: true,
  includeFavIconForNewEntries: true,
});

const DBS = [db('work', 'db-work', false), db('personal', 'db-personal', true)];

const entry = (databaseId: string, title: string): Credential =>
  ({ uuid: `${databaseId}-${title}`, databaseId, title }) as Credential;

/** Minimal stand-in for a Session: answers mt=1 from a fixed entry list. */
function fakeSession(entries: readonly Credential[]): Session {
  return {
    rpc: (_mt: number, req: SearchRequest) => {
      const hits = entries.filter((e) => req.query === '' || e.title.includes(req.query));
      return Promise.resolve({ results: (req.skip ?? 0) === 0 ? hits : [] });
    },
  } as unknown as Session;
}

test('a locked database is a not-running error, not a missing-entry error', () => {
  expect(() => resolveDatabase(DBS, 'personal')).toThrow(NotRunningError);
  expect(() => resolveDatabase(DBS, 'nope')).toThrow(UserError);
  expect(resolveDatabase(DBS, 'work').uuid).toBe('db-work');
  expect(resolveDatabase(DBS, undefined).uuid).toBe('db-work'); // sole unlocked
});

test('--database disambiguates a title shared across databases', async () => {
  const session = fakeSession([entry('db-work', 'github'), entry('db-personal', 'github')]);
  await expect(resolveEntry(session, 'github')).rejects.toThrow(/ambiguous/);
  expect((await resolveEntry(session, 'github', 'db-work')).databaseId).toBe('db-work');
});

test('--database excludes entries from other databases', async () => {
  const session = fakeSession([entry('db-work', 'github')]);
  await expect(resolveEntry(session, 'github', 'db-personal')).rejects.toThrow(
    /no entry matched .* in that database/,
  );
});

/**
 * Stand-in for the unlock round-trip. mt=5 blocks on Strongbox's prompt and
 * then acks the outcome — `{success: false}` if the user cancelled — so
 * `grants` models the user's answer.
 */
function unlockingSession(grants: boolean): { session: Session; unlockCalls: () => number } {
  let calls = 0;
  const session = {
    rpc: (mt: number) => {
      if (mt === MessageType.UnlockDatabase) {
        calls += 1;
        return Promise.resolve({ success: grants });
      }
      return Promise.resolve({ databases: DBS.map((d) => db(d.nickName, d.uuid, true)) }); // Hello
    },
  } as unknown as Session;
  return { session, unlockCalls: () => calls };
}

test('--unlock prompts for a locked database and proceeds once granted', async () => {
  const { session, unlockCalls } = unlockingSession(true);
  const db = await scopeDatabase(session, 'work', true);
  expect(db?.uuid).toBe('db-work');
  expect(unlockCalls()).toBe(1);
});

test('a cancelled unlock prompt fails instead of querying an empty vault', async () => {
  const { session, unlockCalls } = unlockingSession(false);
  await expect(scopeDatabase(session, 'work', true)).rejects.toThrow(NotRunningError);
  expect(unlockCalls()).toBe(1);
});

test('without --unlock a locked database is rejected without prompting', async () => {
  const { session, unlockCalls } = unlockingSession(false);
  await expect(scopeDatabase(session, 'work')).rejects.toThrow(NotRunningError);
  expect(unlockCalls()).toBe(0);
});
