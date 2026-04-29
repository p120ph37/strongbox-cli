import { Command } from 'commander';
import { applyGlobalOpts, emit, withSession, type GlobalOpts } from './_shared.ts';
import { MessageType } from '../protocol/messages.ts';

export function registerUrlCommand(program: Command): void {
  program
    .command('url <url>')
    .description("find credentials matching a URL (the extension's main query)")
    .action(async (url: string) => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      const result = await withSession((s) =>
        s.rpc(MessageType.CredentialsForUrl, { url, skip: 0, take: 9 }),
      );
      emit(result, Boolean(parent.json));
    });
}
