/**
 * Find and parse Strongbox's Native Messaging host manifest.
 *
 * On macOS, Chrome and Firefox look up per-extension / per-app manifests in
 * well-known per-user directories. Strongbox drops its manifest(s) into those
 * directories when the Pro browser-autofill feature is enabled.
 *
 * We walk the candidate locations, parse every manifest, and return the ones
 * whose `allowed_origins` (Chrome) or `allowed_extensions` (Firefox) match
 * the known Strongbox extension identifiers.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Chrome Web Store ID of the Strongbox autofill extension. */
export const CHROME_EXTENSION_ID = 'mnilpkfepdibngheginihjpknnopchbn';
export const CHROME_EXTENSION_ORIGIN = `chrome-extension://${CHROME_EXTENSION_ID}/`;

/** Directories Chrome and its variants look in for per-user native messaging manifests. */
const CHROME_MANIFEST_DIRS = [
  '~/Library/Application Support/Google/Chrome/NativeMessagingHosts',
  '~/Library/Application Support/Google/Chrome Beta/NativeMessagingHosts',
  '~/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts',
  '~/Library/Application Support/Chromium/NativeMessagingHosts',
  '~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts',
  '~/Library/Application Support/Microsoft Edge/NativeMessagingHosts',
  '~/Library/Application Support/Vivaldi/NativeMessagingHosts',
  '~/Library/Application Support/Arc/User Data/NativeMessagingHosts',
];

const FIREFOX_MANIFEST_DIRS = [
  '~/Library/Application Support/Mozilla/NativeMessagingHosts',
];

export interface NativeMessagingManifest {
  /** Absolute path to the .json manifest on disk. */
  manifestPath: string;
  /** The browser family that would consume this manifest. */
  browser: 'chromium' | 'firefox';
  /** Parsed manifest contents. Shape is specified by the browser, not by us. */
  data: {
    name: string;
    description?: string;
    path: string;
    type: string;
    allowed_origins?: string[];
    allowed_extensions?: string[];
  };
}

function expandTilde(p: string): string {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/** Read every .json file in `dir` and attempt to parse each as a manifest. */
async function readManifests(
  dir: string,
  browser: 'chromium' | 'firefox',
): Promise<NativeMessagingManifest[]> {
  if (!(await dirExists(dir))) return [];
  const entries = await readdir(dir);
  const results: NativeMessagingManifest[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const full = join(dir, entry);
    try {
      const raw = await readFile(full, 'utf-8');
      const parsed = JSON.parse(raw) as NativeMessagingManifest['data'];
      results.push({ manifestPath: full, browser, data: parsed });
    } catch {
      // Ignore unreadable / malformed manifests — they may belong to other apps.
    }
  }
  return results;
}

/**
 * Return every Strongbox-associated Native Messaging manifest we can find,
 * across all supported browser families.
 *
 * A manifest is considered Strongbox-associated if its `allowed_origins`
 * (Chrome) contains the Strongbox extension origin, or its
 * `allowed_extensions` (Firefox) contains the add-on ID.
 *
 * TODO(M1): fill in the Firefox add-on ID once we've observed it.
 */
export async function findStrongboxManifests(): Promise<NativeMessagingManifest[]> {
  const chromium = (
    await Promise.all(CHROME_MANIFEST_DIRS.map((d) => readManifests(expandTilde(d), 'chromium')))
  ).flat();
  const firefox = (
    await Promise.all(FIREFOX_MANIFEST_DIRS.map((d) => readManifests(expandTilde(d), 'firefox')))
  ).flat();

  return [...chromium, ...firefox].filter((m) => {
    if (m.browser === 'chromium') {
      return (m.data.allowed_origins ?? []).includes(CHROME_EXTENSION_ORIGIN);
    }
    // Firefox: TBD the exact add-on ID; fall back to a name-based heuristic
    // that is narrow enough to be unlikely to false-positive.
    const allowed = m.data.allowed_extensions ?? [];
    return allowed.some((a) => a.toLowerCase().includes('strongbox'));
  });
}

/**
 * Pick a single manifest to work with. Preference order: Chromium-family
 * manifests first (protocol arguments are simpler — one argv), Firefox second.
 */
export async function pickStrongboxManifest(): Promise<NativeMessagingManifest | null> {
  const all = await findStrongboxManifests();
  if (all.length === 0) return null;
  return all.find((m) => m.browser === 'chromium') ?? all[0] ?? null;
}
