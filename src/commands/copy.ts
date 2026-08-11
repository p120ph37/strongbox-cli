import { Command } from 'commander';
import { applyGlobalOpts, emit, resolveEntry, withSession, type GlobalOpts } from './_shared.ts';
import { MessageType } from '../protocol/messages.ts';
import { UserError } from '../util/errors.ts';

interface CopyOpts {
  field?: string;
}

/**
 * mt=3 CopyField `field` selector, observed by clipboard read-back:
 * 0=username, 1=password, 2=TOTP. Values >=3 are rejected by the server.
 */
const FIELD_CODE: Record<string, number> = { username: 0, password: 1, totp: 2 };

export function registerCopyCommand(program: Command): void {
  program
    .command('copy <ref>')
    .description(
      'copy an entry field to the OS clipboard via Strongbox (username, password, or totp)',
    )
    .option('--field <name>', 'field to copy: username, password, or totp', 'password')
    .action(async (ref: string, opts: CopyOpts) => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);

      const field = opts.field ?? 'password';
      const code = FIELD_CODE[field];
      if (code === undefined) {
        throw new UserError(`--field must be one of username, password, totp (got "${field}")`);
      }

      const message = await withSession(async (s) => {
        const entry = await resolveEntry(s, ref);
        if (field === 'totp' && !entry.totp) {
          throw new UserError(`entry "${entry.title}" has no TOTP configured`);
        }
        // Strongbox writes the value to the OS clipboard and returns only
        // {success}. The value never crosses the wire back to us, so nothing
        // secret is printed — the clipboard is the delivery channel.
        await s.rpc(MessageType.CopyField, {
          databaseId: entry.databaseId,
          nodeId: entry.uuid,
          explicitTotp: field === 'totp',
          field: code,
        });
        return `copied ${field} of "${entry.title}" to the clipboard`;
      });
      emit(message, Boolean(parent.json));
    });
}
