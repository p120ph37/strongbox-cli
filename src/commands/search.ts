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
      // No observed messageType performs a generic title search. The only
      // query op is SearchByUrl (messageType=2); a title search would have
      // to be implemented client-side after listing, once fetching entries
      // is possible.
      throw new UnimplementedError('search — no observed title-search messageType');
    });
}
