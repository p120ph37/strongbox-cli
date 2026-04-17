import { Command } from 'commander';
import { applyGlobalOpts, emit, withSession, type GlobalOpts } from './_shared.ts';
import { Op } from '../protocol/messages.ts';

export function registerTotpCommand(program: Command): void {
  program
    .command('totp <ref>')
    .description('current TOTP code for an entry')
    .action(async (ref: string) => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      const result = await withSession((s) =>
        s.rpc({ id: crypto.randomUUID(), op: Op.getTotp, args: { ref } }),
      );
      emit(result, Boolean(parent.json));
    });
}
