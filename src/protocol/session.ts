/**
 * A higher-level session object that commands use.
 *
 * Responsibilities:
 *   - discover the manifest
 *   - load or create the persistent client identity
 *   - spawn afproxy
 *   - perform the handshake (TBD — see docs/PROTOCOL.md §4.1)
 *   - encrypt outgoing RPCs, decrypt incoming responses
 *   - correlate request/response IDs
 *
 * Until the handshake shape is known, the class compiles and can be
 * instantiated, but calls that would require encrypted communication throw
 * `UnimplementedError`. This lets the CLI surface useful errors and lets
 * commands be written against the right interface from day one.
 */

import { Afproxy } from '../transport/afproxy.ts';
import { pickStrongboxManifest } from '../transport/manifest.ts';
import { loadOrCreateIdentity, type Identity } from '../crypto/identity.ts';
import {
  EnvironmentError,
  HandshakeError,
  UnimplementedError,
  NotRunningError,
} from '../util/errors.ts';
import { trace } from '../util/log.ts';
import type { RpcRequest, RpcResponse } from './messages.ts';

export interface SessionOptions {
  /** Override the binary path. Primarily for tests. */
  manifestPathOverride?: string;
}

export class Session {
  private constructor(
    readonly identity: Identity,
    private readonly proc: Afproxy,
    private peerPublicKey: Uint8Array | null,
  ) {}

  static async open(_opts: SessionOptions = {}): Promise<Session> {
    const manifest = await pickStrongboxManifest();
    if (!manifest) {
      throw new EnvironmentError(
        'no Strongbox Native Messaging manifest found. Is Strongbox Pro installed and is ' +
          'the browser-autofill extension enabled?',
      );
    }
    trace('using manifest:', manifest.manifestPath);

    const identity = await loadOrCreateIdentity();

    let proc: Afproxy;
    try {
      proc = await Afproxy.spawn({ manifest });
    } catch (err) {
      throw new NotRunningError(
        `failed to spawn afproxy at ${manifest.data.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const session = new Session(identity, proc, null);
    try {
      await session.handshake();
    } catch (err) {
      await proc.close();
      throw err;
    }
    return session;
  }

  /**
   * Perform the handshake. Real implementation is TBD — see
   * docs/PROTOCOL.md §4.1. For now we throw so callers fail fast with a
   * useful error.
   */
  private async handshake(): Promise<void> {
    // Suppress the "unused" warning for peerPublicKey until the real
    // handshake lands. TODO(M3): replace with the observed handshake.
    void this.peerPublicKey;
    throw new HandshakeError(
      'handshake not yet implemented. See docs/REVERSE_ENGINEERING.md for the plan.',
    );
  }

  /**
   * Send an encrypted RPC and await the response. Throws until the crypto
   * layer and handshake are implemented.
   */
  async rpc<Op extends string, Args, Result>(
    _request: RpcRequest<Op, Args>,
  ): Promise<RpcResponse<Result>> {
    throw new UnimplementedError('encrypted RPC');
  }

  async close(): Promise<void> {
    await this.proc.close();
  }
}
