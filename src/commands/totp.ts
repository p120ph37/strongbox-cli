import { Command } from 'commander';
import { applyGlobalOpts, emit, resolveEntry, withSession, type GlobalOpts } from './_shared.ts';
import { UserError } from '../util/errors.ts';
import { totpFromUri } from '../util/totp.ts';

export function registerTotpCommand(program: Command): void {
  program
    .command('totp <ref>')
    .description('current TOTP code for an entry (by UUID or exact title)')
    .action(async (ref: string) => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      const entry = await withSession((s) => resolveEntry(s, ref));
      if (!entry.totp) throw new UserError(`entry "${entry.title}" has no TOTP configured`);
      // Strongbox returns the shared secret as an otpauth URI, not a live
      // code; compute the digits locally (RFC 6238).
      emit(totpFromUri(entry.totp, Date.now()), Boolean(parent.json));
    });
}
