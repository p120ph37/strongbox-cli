/**
 * Shared helpers used across the subcommand modules. Kept small on purpose;
 * if this file grows, break it up.
 */

import { Session } from '../protocol/session.ts';
import { setVerbose } from '../util/log.ts';

export interface GlobalOpts {
  json?: boolean;
  verbose?: boolean;
}

/** Apply global options that affect process-wide state (verbose logging). */
export function applyGlobalOpts(opts: GlobalOpts): void {
  setVerbose(Boolean(opts.verbose));
}

/**
 * Open a session, run a callback, and always close the session. Commander
 * subcommands should use this rather than managing sessions themselves.
 */
export async function withSession<T>(fn: (s: Session) => Promise<T>): Promise<T> {
  const session = await Session.open();
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

/**
 * Emit output honouring --json. Scalars and structured objects are handled
 * differently so that shell pipelines work cleanly in the default mode.
 */
export function emit(value: unknown, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
    return;
  }
  if (typeof value === 'string') {
    process.stdout.write(value);
    if (!value.endsWith('\n')) process.stdout.write('\n');
    return;
  }
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}
