import { Command } from 'commander';
import {
  applyGlobalOpts,
  emit,
  publicView,
  searchEntries,
  withSession,
  type GlobalOpts,
} from './_shared.ts';

export function registerSearchCommand(program: Command): void {
  program
    .command('search [query]')
    .description('full-text search entries across unlocked databases (no query lists all)')
    .action(async (query: string | undefined) => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      // Optional so `search` (or `search ''`) enumerates everything — commander
      // rejects an empty string against a required <query>.
      const entries = await withSession((s) => searchEntries(s, query ?? ''));
      emit(entries.map(publicView), Boolean(parent.json));
    });
}
