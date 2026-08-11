#!/usr/bin/env bun
import { Command } from 'commander';
import { registerDiagnoseCommand } from './commands/diagnose.ts';
import { registerStatusCommand } from './commands/status.ts';
import { registerListCommand } from './commands/list.ts';
import { registerSearchCommand } from './commands/search.ts';
import { registerGetCommand } from './commands/get.ts';
import { registerUrlCommand } from './commands/url.ts';
import { registerTotpCommand } from './commands/totp.ts';
import { registerCopyCommand } from './commands/copy.ts';
import { registerAddCommand } from './commands/add.ts';
import { StrongboxError } from './util/errors.ts';
import pkg from '../package.json' with { type: 'json' };

const program = new Command();

program
  .name('strongbox-cli')
  .description('Independent CLI client for the Strongbox password manager')
  .version(pkg.version)
  .option('--json', 'emit machine-readable JSON on stdout', false)
  .option('-v, --verbose', 'log transport-level details to stderr', false);

registerDiagnoseCommand(program);
registerStatusCommand(program);
registerListCommand(program);
registerSearchCommand(program);
registerGetCommand(program);
registerUrlCommand(program);
registerTotpCommand(program);
registerCopyCommand(program);
registerAddCommand(program);

try {
  await program.parseAsync(process.argv);
} catch (err) {
  if (err instanceof StrongboxError) {
    process.stderr.write(`${err.code}: ${err.message}\n`);
    process.exit(err.exitCode);
  }
  if (err instanceof Error) {
    process.stderr.write(`error: ${err.message}\n`);
    if (program.opts()['verbose'] && err.stack) {
      process.stderr.write(`${err.stack}\n`);
    }
    process.exit(1);
  }
  process.stderr.write(`unknown error: ${String(err)}\n`);
  process.exit(1);
}
