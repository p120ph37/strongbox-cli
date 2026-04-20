import { Command } from 'commander';
import { applyGlobalOpts, type GlobalOpts } from './_shared.ts';
import { UnimplementedError } from '../util/errors.ts';

export function registerTotpCommand(program: Command): void {
  program
    .command('totp <ref>')
    .description('current TOTP code for an entry')
    .action((_ref: string) => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      // The only TOTP-related op observed is messageType=3 (CopyField) with
      // explicitTotp=true, which injects the code via the OS paste path
      // rather than returning it. Returning TOTP to stdout needs a
      // different (unobserved) op, or decoding the stored TOTP URI
      // client-side from a Credential record.
      throw new UnimplementedError('totp — no observed return-TOTP messageType');
    });
}
