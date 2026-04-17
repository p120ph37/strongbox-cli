/**
 * Minimal stderr logger. Gated by a single process-wide flag that cli.ts flips
 * based on --verbose. Stdout is reserved for command output; diagnostics,
 * progress, and trace information all go to stderr.
 */

let verbose = false;

export function setVerbose(on: boolean): void {
  verbose = on;
}

export function trace(...parts: unknown[]): void {
  if (!verbose) return;
  process.stderr.write(`[trace] ${parts.map(formatPart).join(' ')}\n`);
}

export function warn(...parts: unknown[]): void {
  process.stderr.write(`[warn] ${parts.map(formatPart).join(' ')}\n`);
}

function formatPart(p: unknown): string {
  if (typeof p === 'string') return p;
  try {
    return JSON.stringify(p);
  } catch {
    return String(p);
  }
}
