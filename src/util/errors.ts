/**
 * Base class for errors this CLI raises. Carries a stable machine-readable
 * code, an exit code, and a human-readable message.
 *
 * Exit-code conventions (roughly sysexits(3)-influenced, adjusted for this tool):
 *   2  — user error (bad argument, unknown entry, etc.)
 *   3  — environment not set up (Strongbox not installed, manifest missing)
 *   4  — Strongbox not running / not unlocked
 *   5  — authentication / handshake failure
 *   6  — transport failure (socket, stdio)
 *   7  — protocol violation (unexpected message shape)
 *   10 — unimplemented (stub / placeholder command)
 *   1  — anything else
 */
export abstract class StrongboxError extends Error {
  abstract readonly code: string;
  abstract readonly exitCode: number;
}

export class UserError extends StrongboxError {
  readonly code = 'user-error';
  readonly exitCode = 2;
}

export class EnvironmentError extends StrongboxError {
  readonly code = 'environment-error';
  readonly exitCode = 3;
}

export class NotRunningError extends StrongboxError {
  readonly code = 'not-running';
  readonly exitCode = 4;
}

export class HandshakeError extends StrongboxError {
  readonly code = 'handshake-failed';
  readonly exitCode = 5;
}

export class TransportError extends StrongboxError {
  readonly code = 'transport-error';
  readonly exitCode = 6;
}

export class ProtocolError extends StrongboxError {
  readonly code = 'protocol-error';
  readonly exitCode = 7;
}

export class UnimplementedError extends StrongboxError {
  readonly code = 'unimplemented';
  readonly exitCode = 10;
  constructor(feature: string) {
    super(`not yet implemented: ${feature}`);
  }
}
