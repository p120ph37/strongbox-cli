/**
 * `strongbox-cli diagnose`
 *
 * Dumps everything we can learn about the local Strongbox environment
 * without actually talking to Strongbox. Useful both for us during
 * development and for users reporting bugs.
 *
 * This command is intentionally fully implementable today — it doesn't
 * require the RPC protocol to be reverse-engineered.
 */

import { Command } from 'commander';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findStrongboxManifests } from '../transport/manifest.ts';
import { IDENTITY_PATH } from '../crypto/identity.ts';
import { setVerbose } from '../util/log.ts';

export function registerDiagnoseCommand(program: Command): void {
  program
    .command('diagnose')
    .description('print Strongbox environment details; does not contact Strongbox')
    .action(async () => {
      const parent = program.opts();
      setVerbose(Boolean(parent['verbose']));

      const report = await buildReport();

      if (parent['json']) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        return;
      }

      process.stdout.write(formatReport(report));
    });
}

interface Report {
  platform: string;
  groupContainer: PathProbe;
  sshAgentSocket: PathProbe;
  autofillSocketCandidates: PathProbe[];
  manifests: Array<{
    path: string;
    browser: string;
    name: string;
    targetBinary: string;
    targetExists: boolean;
    allowedOrigins: string[];
    allowedExtensions: string[];
  }>;
  identityFile: PathProbe;
}

interface PathProbe {
  path: string;
  exists: boolean;
  note?: string;
}

async function probe(path: string, note?: string): Promise<PathProbe> {
  try {
    await access(path);
    return note === undefined ? { path, exists: true } : { path, exists: true, note };
  } catch {
    return note === undefined ? { path, exists: false } : { path, exists: false, note };
  }
}

async function buildReport(): Promise<Report> {
  const home = homedir();
  const groupContainer = join(home, 'Library', 'Group Containers', 'group.strongbox.mac.mcguill');

  const manifests = await findStrongboxManifests();

  return {
    platform: `${process.platform} ${process.arch}`,
    groupContainer: await probe(groupContainer, 'shared app state for Strongbox'),
    sshAgentSocket: await probe(
      join(groupContainer, 'agent.sock'),
      'standard OpenSSH agent socket',
    ),
    autofillSocketCandidates: await Promise.all([
      probe(join(groupContainer, 'autofill.sock'), 'candidate filename'),
      probe(join(groupContainer, 'afproxy.sock'), 'candidate filename'),
      probe(join(groupContainer, 'browser.sock'), 'candidate filename'),
    ]),
    manifests: await Promise.all(
      manifests.map(async (m) => ({
        path: m.manifestPath,
        browser: m.browser,
        name: m.data.name,
        targetBinary: m.data.path,
        targetExists: await fileExists(m.data.path),
        allowedOrigins: m.data.allowed_origins ?? [],
        allowedExtensions: m.data.allowed_extensions ?? [],
      })),
    ),
    identityFile: await probe(IDENTITY_PATH, 'client keypair'),
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile() || s.isSymbolicLink();
  } catch {
    return false;
  }
}

function formatReport(r: Report): string {
  const lines: string[] = [];
  const check = (ok: boolean): string => (ok ? '✓' : '✗');

  lines.push(`platform: ${r.platform}`);
  lines.push('');
  lines.push('group container:');
  lines.push(`  ${check(r.groupContainer.exists)} ${r.groupContainer.path}`);
  lines.push('');
  lines.push('ssh agent socket:');
  lines.push(`  ${check(r.sshAgentSocket.exists)} ${r.sshAgentSocket.path}`);
  lines.push('');
  lines.push('autofill socket candidates:');
  for (const c of r.autofillSocketCandidates) {
    lines.push(`  ${check(c.exists)} ${c.path}`);
  }
  lines.push('');
  lines.push('native messaging manifests:');
  if (r.manifests.length === 0) {
    lines.push('  (none found — is the Strongbox extension installed and app running?)');
  }
  for (const m of r.manifests) {
    lines.push(`  • ${m.path}`);
    lines.push(`    browser:   ${m.browser}`);
    lines.push(`    name:      ${m.name}`);
    lines.push(`    target:    ${check(m.targetExists)} ${m.targetBinary}`);
    if (m.allowedOrigins.length > 0) {
      lines.push(`    origins:   ${m.allowedOrigins.join(', ')}`);
    }
    if (m.allowedExtensions.length > 0) {
      lines.push(`    ext ids:   ${m.allowedExtensions.join(', ')}`);
    }
  }
  lines.push('');
  lines.push('client identity:');
  lines.push(`  ${check(r.identityFile.exists)} ${r.identityFile.path}`);
  lines.push('');
  return lines.join('\n');
}
