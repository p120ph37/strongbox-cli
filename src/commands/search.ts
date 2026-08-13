import { Command } from 'commander';
import {
  applyGlobalOpts,
  emit,
  publicView,
  scopeDatabase,
  searchEntries,
  withSession,
  type GlobalOpts,
} from './_shared.ts';

export function registerSearchCommand(program: Command): void {
  program
    .command('search [query]')
    .description('full-text search entries across unlocked databases (no query lists all)')
    .option('--database <ref>', 'search only this database; fails if it is locked')
    .action(async (query: string | undefined, opts: { database?: string }) => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      // Optional so `search` (or `search ''`) enumerates everything — commander
      // rejects an empty string against a required <query>.
      const entries = await withSession(async (s) => {
        // mt=1 has no database parameter, so scoping is a client-side filter.
        const db = await scopeDatabase(s, opts.database);
        const hits = await searchEntries(s, query ?? '');
        return db === undefined ? hits : hits.filter((e) => e.databaseId === db.uuid);
      });
      emit(entries.map(publicView), Boolean(parent.json));
    });
}
