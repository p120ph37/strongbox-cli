import { Command } from 'commander';
import { applyGlobalOpts, emit, withSession, type GlobalOpts } from './_shared.ts';
import { Op } from '../protocol/messages.ts';

interface GetOpts {
  field?: string;
}

export function registerGetCommand(program: Command): void {
  program
    .command('get <ref>')
    .description('retrieve one entry by reference (UUID or canonical path)')
    .option('--field <name>', 'print only the named field (password, username, totp, url, notes)')
    .action(async (ref: string, opts: GetOpts) => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      const args: Record<string, unknown> = { ref };
      if (opts.field !== undefined) args['field'] = opts.field;
      const result = await withSession((s) =>
        s.rpc({ id: crypto.randomUUID(), op: Op.getEntry, args }),
      );
      emit(result, Boolean(parent.json));
    });
}
