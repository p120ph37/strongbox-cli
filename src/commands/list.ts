import { Command } from 'commander';
import { applyGlobalOpts, emit, withSession, type GlobalOpts } from './_shared.ts';
import { MessageType } from '../protocol/messages.ts';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('enumerate databases known to Strongbox')
    .action(async () => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      const hello = await withSession((s) => s.rpc(MessageType.Hello, {}));
      emit(hello.databases, Boolean(parent.json));
    });
}
