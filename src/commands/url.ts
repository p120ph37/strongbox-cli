import { Command } from 'commander';
import { applyGlobalOpts, emit, withSession, type GlobalOpts } from './_shared.ts';
import { Op } from '../protocol/messages.ts';

export function registerUrlCommand(program: Command): void {
  program
    .command('url <url>')
    .description('find credentials matching a URL (the extension\'s main query)')
    .action(async (url: string) => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      const result = await withSession((s) =>
        s.rpc({ id: crypto.randomUUID(), op: Op.getCredentialsForUrl, args: { url } }),
      );
      emit(result, Boolean(parent.json));
    });
}
