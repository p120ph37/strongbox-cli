import { Command } from 'commander';
import { applyGlobalOpts, emit, withSession, type GlobalOpts } from './_shared.ts';
import { Op } from '../protocol/messages.ts';

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query>')
    .description('fuzzy-match entries by title across unlocked databases')
    .action(async (query: string) => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      const result = await withSession((s) =>
        s.rpc({ id: crypto.randomUUID(), op: Op.search, args: { query } }),
      );
      emit(result, Boolean(parent.json));
    });
}
