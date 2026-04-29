import { Command } from 'commander';
import { applyGlobalOpts, type GlobalOpts } from './_shared.ts';
import { UnimplementedError } from '../util/errors.ts';

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query>')
    .description('fuzzy-match entries by title across unlocked databases')
    .action((_query: string) => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      // mt=1 is dispatched as `SearchRequest` (per the 2026-04-20 probe
      // sweep) but its full request schema is unobserved — the probes only
      // recovered the class name, not the field set. Until a real title
      // search is captured, treat this as unimplemented.
      throw new UnimplementedError('search — mt=1 SearchRequest schema unobserved');
    });
}
