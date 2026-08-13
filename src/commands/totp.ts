import { Command } from 'commander';
import {
  applyGlobalOpts,
  emit,
  resolveEntry,
  scopeDatabase,
  withSession,
  type GlobalOpts,
} from './_shared.ts';
import { UserError } from '../util/errors.ts';
import { totpFromUri } from '../util/totp.ts';

export function registerTotpCommand(program: Command): void {
  program
    .command('totp <ref>')
    .description(
      'current TOTP code for an entry (by UUID or exact title); ' +
        'for the raw secret use `get <ref> --field totp-secret` (or `totp-uri`)',
    )
    .option('--database <ref>', 'search only this database; fails if it is locked')
    .action(async (ref: string, opts: { database?: string }) => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      const entry = await withSession(async (s) => {
        const db = await scopeDatabase(s, opts.database);
        return resolveEntry(s, ref, db?.uuid);
      });
      if (!entry.totp) throw new UserError(`entry "${entry.title}" has no TOTP configured`);
      // Strongbox returns the shared secret as an otpauth URI, not a live
      // code; compute the digits locally (RFC 6238).
      emit(totpFromUri(entry.totp, Date.now()), Boolean(parent.json));
    });
}
