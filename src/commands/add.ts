import { Command } from 'commander';
import {
  applyGlobalOpts,
  emit,
  publicView,
  resolveDatabase,
  withSession,
  type GlobalOpts,
} from './_shared.ts';
import { MessageType } from '../protocol/messages.ts';
import type { Session } from '../protocol/session.ts';
import { UserError } from '../util/errors.ts';

interface AddOpts {
  database?: string;
  group?: string;
  username?: string;
  url?: string;
  password?: string;
  passwordStdin?: boolean;
  generate?: boolean;
}

/** Resolve a group ref (exact title or `/`-joined path) to its UUID; default to the root group. */
async function resolveGroup(
  session: Session,
  databaseId: string,
  ref: string | undefined,
): Promise<string> {
  const { groups } = await session.rpc(MessageType.ListGroups, { databaseId });
  if (!ref) {
    const root = groups[0]; // mt=7 returns the root group first
    if (!root) throw new UserError('database reports no groups');
    return root.uuid;
  }
  const m = groups.find((g) => g.title === ref);
  if (!m) {
    throw new UserError(`no group "${ref}" (available: ${groups.map((g) => g.title).join(', ')})`);
  }
  return m.uuid;
}

export function registerAddCommand(program: Command): void {
  program
    .command('add <title>')
    .description(
      'create a new entry (title/username/password/url only — no notes/totp/custom fields)',
    )
    .option('--database <ref>', 'target database nickname or UUID (default: the sole unlocked one)')
    .option('--group <name>', 'group title or /-joined path (default: root group)')
    .option('--username <u>', 'username', '')
    .option('--url <url>', 'URL', '')
    .option('--password <p>', 'password (visible in the process list — prefer --password-stdin)')
    .option('--password-stdin', 'read the password from stdin')
    .option('--generate', 'generate a password (printed so you can use it)')
    .action(async (title: string, opts: AddOpts) => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);

      const sources = [
        opts.password !== undefined,
        Boolean(opts.passwordStdin),
        Boolean(opts.generate),
      ].filter(Boolean).length;
      if (sources !== 1) {
        throw new UserError('provide exactly one of --password, --password-stdin, or --generate');
      }

      const { entry, generated } = await withSession(async (s) => {
        const hello = await s.rpc(MessageType.Hello, {});
        if (!hello.serverSettings.supportsCreateNew) {
          throw new UserError('this Strongbox build does not support creating entries');
        }
        const db = resolveDatabase(hello.databases, opts.database);
        const groupId = await resolveGroup(s, db.uuid, opts.group);

        let password: string;
        if (opts.generate) {
          password = (await s.rpc(MessageType.GeneratePassword, {})).password.password;
        } else if (opts.passwordStdin) {
          password = (await Bun.stdin.text()).replace(/\r?\n$/, '');
        } else {
          password = opts.password!;
        }

        const res = await s.rpc(MessageType.CreateEntry, {
          databaseId: db.uuid,
          groupId,
          icon: '',
          title,
          username: opts.username ?? '',
          password,
          url: opts.url ?? '',
        });
        return { entry: res.credential, generated: opts.generate ? password : undefined };
      });

      const out: Record<string, unknown> = { created: publicView(entry) };
      // A generated password is printed because the user asked to generate it
      // and would otherwise have no way to learn it.
      if (generated !== undefined) out['generatedPassword'] = generated;
      emit(out, Boolean(parent.json));
    });
}
