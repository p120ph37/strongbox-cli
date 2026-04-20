import { Command } from 'commander';
import { applyGlobalOpts, emit, withSession, type GlobalOpts } from './_shared.ts';
import { MessageType } from '../protocol/messages.ts';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('ping Strongbox and report its lock/unlock state')
    .action(async () => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      const result = await withSession((s) => s.rpc(MessageType.Hello, {}));
      emit(result, Boolean(parent.json));
    });
}
