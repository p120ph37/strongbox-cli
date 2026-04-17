import { Command } from 'commander';
import { applyGlobalOpts, emit, withSession, type GlobalOpts } from './_shared.ts';
import { Op } from '../protocol/messages.ts';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('enumerate unlocked databases known to Strongbox')
    .action(async () => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      const result = await withSession((s) =>
        s.rpc({ id: crypto.randomUUID(), op: Op.listDatabases, args: {} }),
      );
      emit(result, Boolean(parent.json));
    });
}
