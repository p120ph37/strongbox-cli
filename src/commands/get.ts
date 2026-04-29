import { Command } from 'commander';
import { applyGlobalOpts, type GlobalOpts } from './_shared.ts';
import { UnimplementedError } from '../util/errors.ts';

interface GetOpts {
  field?: string;
}

export function registerGetCommand(program: Command): void {
  program
    .command('get <ref>')
    .description('retrieve one entry by reference (UUID or canonical path)')
    .option('--field <name>', 'print only the named field (password, username, totp, url, notes)')
    .action((_ref: string, _opts: GetOpts) => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      // No observed messageType fetches a single entry by opaque ref. The
      // wire protocol works in (databaseId, nodeId) pairs; a two-step
      // resolve-then-fetch will land once a non-empty CredentialsForUrl
      // (mt=2) capture lets us pin down the result element schema.
      throw new UnimplementedError('get <ref> — awaiting non-empty CredentialsForUrl capture');
    });
}
