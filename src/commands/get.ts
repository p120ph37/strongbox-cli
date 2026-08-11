import { Command } from 'commander';
import {
  applyGlobalOpts,
  emit,
  fullView,
  publicView,
  resolveEntry,
  withSession,
  type GlobalOpts,
} from './_shared.ts';
import { UserError } from '../util/errors.ts';
import { parseOtpauth, totpFromUri } from '../util/totp.ts';
import type { Credential } from '../protocol/messages.ts';

interface GetOpts {
  field?: string;
  reveal?: boolean;
  icon?: boolean;
}

/** Named built-in fields; anything else is looked up as a custom-field key. */
function fieldValue(c: Credential, name: string): string {
  switch (name) {
    case 'password':
      return c.password;
    case 'username':
      return c.username;
    case 'url':
      return c.url;
    case 'title':
      return c.title;
    case 'uuid':
      return c.uuid;
    case 'notes':
      return c.notes;
    case 'icon':
      return c.icon;
    case 'totp': {
      if (!c.totp) throw new UserError(`entry "${c.title}" has no TOTP configured`);
      return totpFromUri(c.totp, Date.now());
    }
    // Secret export: Strongbox's UI hides the raw seed, but it ships the full
    // otpauth URI in the record. `totp-uri` is the whole URI (QR / app import);
    // `totp-secret` is just the Base32 seed (e.g. for `oathtool -b`).
    case 'totp-uri': {
      if (!c.totp) throw new UserError(`entry "${c.title}" has no TOTP configured`);
      return c.totp;
    }
    case 'totp-secret': {
      if (!c.totp) throw new UserError(`entry "${c.title}" has no TOTP configured`);
      return parseOtpauth(c.totp).secret;
    }
    default: {
      const cf = c.customFields.find((f) => f.key === name);
      if (!cf) throw new UserError(`entry "${c.title}" has no field "${name}"`);
      return cf.value;
    }
  }
}

export function registerGetCommand(program: Command): void {
  program
    .command('get <ref>')
    .description('retrieve one entry by UUID or exact title')
    .option(
      '--field <name>',
      'print only the named field: password, username, url, title, uuid, notes, ' +
        'icon, totp (current code), totp-uri, totp-secret, or a custom-field key',
    )
    .option('--reveal', 'print the full record including secrets (password, TOTP URI, notes, custom values)')
    .option('--icon', 'include the icon (a multi-KB data URI, omitted by default) in the record view')
    .action(async (ref: string, opts: GetOpts) => {
      const parent = program.opts<GlobalOpts>();
      applyGlobalOpts(parent);
      const entry = await withSession((s) => resolveEntry(s, ref));

      // A named field is a specific request — always the full value.
      if (opts.field) {
        emit(fieldValue(entry, opts.field), Boolean(parent.json));
        return;
      }
      const view = opts.reveal ? fullView(entry) : publicView(entry);
      emit(opts.icon ? { ...view, icon: entry.icon } : view, Boolean(parent.json));
    });
}
