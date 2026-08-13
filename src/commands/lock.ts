import { Command } from 'commander';
import {
  applyGlobalOpts,
  emit,
  requireDatabase,
  unlockDatabase,
  withSession,
  type GlobalOpts,
} from './_shared.ts';
import { MessageType, type DatabaseSummary } from '../protocol/messages.ts';
import type { Session } from '../protocol/session.ts';
import { NotRunningError } from '../util/errors.ts';
import { trace } from '../util/log.ts';

/** Look a database up by nickname or UUID, in any lock state. */
async function pick(session: Session, ref: string): Promise<DatabaseSummary> {
  return requireDatabase((await session.rpc(MessageType.Hello, {})).databases, ref);
}

export function registerLockCommands(program: Command): void {
  program
    .command('lock <database>')
    .description('lock a database (nickname or UUID)')
    .action(async (ref: string) => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      const message = await withSession(async (s) => {
        const db = await pick(s, ref);
        if (db.locked) return `"${db.nickName}" is already locked`;
        const ack = await s.rpc(MessageType.LockDatabase, { databaseId: db.uuid });
        trace('lock ack:', JSON.stringify(ack));
        if (!ack.success) throw new NotRunningError(`"${db.nickName}" did not lock`);
        return `locked "${db.nickName}"`;
      });
      emit(message, Boolean(parent.json));
    });

  program
    .command('unlock <database>')
    .description(
      'unlock a database (nickname or UUID); raises Strongbox’s master-password / ' +
        'biometric prompt and blocks until it is answered. Exit 0 if unlocked, 4 if not.',
    )
    .action(async (ref: string) => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      const message = await withSession(async (s) => {
        const db = await pick(s, ref);
        if (!db.locked) return `"${db.nickName}" is already unlocked`;
        if (!(await unlockDatabase(s, db))) {
          throw new NotRunningError(
            `"${db.nickName}" was not unlocked (prompt cancelled or failed)`,
          );
        }
        return `unlocked "${db.nickName}"`;
      });
      emit(message, Boolean(parent.json));
    });
}
