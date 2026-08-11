/**
 * `strongbox-cli diagnose`
 *
 * A layered health check for the local Strongbox integration. It observes only
 * system state and Strongbox's own outputs — app bundle, running process,
 * Native Messaging manifest, and a live Hello — and never reads Strongbox's
 * preference or database files.
 *
 * The checks, in the order a failure would bite:
 *   1. Is Strongbox.app installed?
 *   2. Is Strongbox running?
 *   3. Is the Native Messaging manifest present? Its absence is the signal that
 *      the "Enable Chrome & Firefox AutoFill extension" feature is disabled.
 *   4. Can we complete a Hello, and what vaults does it report?
 */

import { Command } from 'commander';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findStrongboxManifests } from '../transport/manifest.ts';
import { IDENTITY_PATH } from '../crypto/identity.ts';
import { Session } from '../protocol/session.ts';
import { MessageType } from '../protocol/messages.ts';
import { StrongboxError } from '../util/errors.ts';
import { setVerbose } from '../util/log.ts';

const STRONGBOX_APP = '/Applications/Strongbox.app';

export function registerDiagnoseCommand(program: Command): void {
  program
    .command('diagnose')
    .description('health-check the local Strongbox integration (app, process, manifest, vaults)')
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

interface VaultInfo {
  nickName: string;
  locked: boolean;
  autoFillEnabled: boolean;
  status: string;
}

interface Connection {
  attempted: boolean;
  ok: boolean;
  serverVersion?: string;
  vaults?: VaultInfo[];
  errorCode?: string;
  errorMessage?: string;
}

interface Report {
  platform: string;
  app: { path: string; installed: boolean };
  process: { running: boolean; pids: number[] };
  manifest: {
    found: boolean;
    interpretation: string;
    path?: string;
    browser?: string;
    afproxyPath?: string;
    afproxyExists?: boolean;
  };
  sshAgentSocket: { path: string; exists: boolean };
  identityFile: { path: string; exists: boolean };
  connection: Connection;
}

async function buildReport(): Promise<Report> {
  const home = homedir();
  const groupContainer = join(home, 'Library', 'Group Containers', 'group.strongbox.mac.mcguill');

  const appInstalled = await pathExists(STRONGBOX_APP);
  const pids = await pgrep('Strongbox');
  const manifests = await findStrongboxManifests();

  const report: Report = {
    platform: `${process.platform} ${process.arch}`,
    app: { path: STRONGBOX_APP, installed: appInstalled },
    process: { running: pids.length > 0, pids },
    manifest: buildManifestSection(manifests, appInstalled),
    sshAgentSocket: {
      path: join(groupContainer, 'agent.sock'),
      exists: await pathExists(join(groupContainer, 'agent.sock')),
    },
    identityFile: { path: IDENTITY_PATH, exists: await pathExists(IDENTITY_PATH) },
    connection: await probeConnection(manifests.length > 0),
  };

  // Fill afproxy target details from the first manifest, if any.
  const m = manifests[0];
  if (m) {
    report.manifest.path = m.manifestPath;
    report.manifest.browser = m.browser;
    report.manifest.afproxyPath = m.data.path;
    report.manifest.afproxyExists = await pathExists(m.data.path);
  }
  return report;
}

function buildManifestSection(
  manifests: Awaited<ReturnType<typeof findStrongboxManifests>>,
  appInstalled: boolean,
): Report['manifest'] {
  if (manifests.length > 0) {
    return { found: true, interpretation: 'browser-autofill extension feature is enabled' };
  }
  return {
    found: false,
    interpretation: appInstalled
      ? 'no manifest — the "Enable Chrome & Firefox AutoFill extension" feature is OFF in Strongbox'
      : 'no manifest and Strongbox.app not found — is Strongbox Pro installed?',
  };
}

/** Attempt a live Hello and summarize the reported vaults. */
async function probeConnection(manifestPresent: boolean): Promise<Connection> {
  if (!manifestPresent) {
    return { attempted: false, ok: false };
  }
  let session: Session | undefined;
  try {
    session = await Session.open();
    const hello = await session.rpc(MessageType.Hello, {});
    return {
      attempted: true,
      ok: true,
      serverVersion: hello.serverVersionInfo,
      vaults: hello.databases.map((d) => ({
        nickName: d.nickName,
        locked: d.locked,
        autoFillEnabled: d.autoFillEnabled,
        status: d.locked
          ? 'locked (unlock in Strongbox to query)'
          : d.autoFillEnabled
            ? 'queryable'
            : 'database AutoFill disabled — entries are NOT exposed to the CLI',
      })),
    };
  } catch (err) {
    const code = err instanceof StrongboxError ? err.code : 'unknown';
    return {
      attempted: true,
      ok: false,
      errorCode: code,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await session?.close();
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** List PIDs of a running process by exact name, via `pgrep -x`. */
async function pgrep(name: string): Promise<number[]> {
  try {
    const proc = Bun.spawn(['pgrep', '-x', name], { stdout: 'pipe', stderr: 'ignore' });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out
      .trim()
      .split('\n')
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

function formatReport(r: Report): string {
  const lines: string[] = [];
  const mark = (ok: boolean): string => (ok ? '✓' : '✗');

  lines.push(`platform: ${r.platform}`);
  lines.push('');
  lines.push(`${mark(r.app.installed)} Strongbox.app installed  (${r.app.path})`);
  lines.push(
    `${mark(r.process.running)} Strongbox running` +
      (r.process.running ? `  (pid ${r.process.pids.join(', ')})` : ''),
  );
  lines.push(`${mark(r.manifest.found)} Native Messaging manifest`);
  lines.push(`    ${r.manifest.interpretation}`);
  if (r.manifest.found && r.manifest.path) {
    lines.push(`    manifest: ${r.manifest.path} (${r.manifest.browser ?? '?'})`);
    lines.push(
      `    afproxy:  ${mark(Boolean(r.manifest.afproxyExists))} ${r.manifest.afproxyPath ?? '?'}`,
    );
  }
  lines.push(`${mark(r.sshAgentSocket.exists)} SSH agent socket  (${r.sshAgentSocket.path})`);
  lines.push(`${mark(r.identityFile.exists)} client identity  (${r.identityFile.path})`);
  lines.push('');

  const c = r.connection;
  if (!c.attempted) {
    lines.push('vaults: (skipped — no manifest, cannot contact Strongbox)');
  } else if (!c.ok) {
    lines.push(`vaults: (could not connect — ${c.errorCode}: ${c.errorMessage})`);
  } else {
    lines.push(`connected to Strongbox ${c.serverVersion ?? '?'}; vaults:`);
    for (const v of c.vaults ?? []) {
      lines.push(`  • ${v.nickName} — ${v.status}`);
    }
    lines.push('');
    lines.push('note: a vault showing zero queryable entries usually has its database-level');
    lines.push('      AutoFill setting disabled (shown above), not that it is empty.');
  }
  lines.push('');
  return lines.join('\n');
}
