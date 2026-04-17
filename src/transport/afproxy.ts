/**
 * afproxy subprocess manager.
 *
 * Given a discovered Native Messaging manifest, spawn the afproxy binary it
 * points at, pipe our framed messages into its stdin, and pull framed replies
 * from its stdout. This layer is transport-only — it knows nothing about the
 * crypto envelope or the RPC vocabulary that rides on top of it.
 *
 * What Chrome passes on stdin/argv when it launches a native host is part of
 * the public Native Messaging spec, so we can match it exactly without
 * observing Strongbox's own source:
 *
 *   argv[0] = path to the host binary
 *   argv[1] = extension origin, e.g. "chrome-extension://mnilp…/"
 *   (Firefox passes a second argument, the extension ID; we match the Chrome
 *    convention because it's simpler and afproxy appears to accept it.)
 *
 * The host's stdout is raw Native Messaging frames; its stderr is free-form
 * text from the host itself, which we surface only under --verbose.
 */

import { spawn, type Subprocess } from 'bun';
import { encodeFrame, FrameDecoder } from './native-messaging.ts';
import { CHROME_EXTENSION_ORIGIN, type NativeMessagingManifest } from './manifest.ts';
import { TransportError } from '../util/errors.ts';
import { trace, warn } from '../util/log.ts';

export interface AfproxyOptions {
  /** Manifest located by `manifest.ts`. Supplies the path to the binary. */
  manifest: NativeMessagingManifest;
  /**
   * Origin to pass as argv[1]. Defaults to the Strongbox Chrome extension
   * origin. Override if you're testing against a different origin.
   */
  origin?: string;
}

/**
 * A running afproxy process with a message-oriented API on top of its stdio.
 *
 * Lifecycle:
 *   const ap = await Afproxy.spawn({ manifest });
 *   await ap.send({ hello: 'world' });
 *   const reply = await ap.recv();
 *   await ap.close();
 */
export class Afproxy {
  private constructor(
    private readonly proc: Subprocess<'pipe', 'pipe', 'pipe'>,
    private readonly decoder: FrameDecoder,
    private readonly incoming: AsyncQueue<unknown>,
    private readonly exitPromise: Promise<number>,
  ) {}

  static async spawn(opts: AfproxyOptions): Promise<Afproxy> {
    const binPath = opts.manifest.data.path;
    const origin = opts.origin ?? CHROME_EXTENSION_ORIGIN;
    trace('spawning afproxy:', binPath, 'origin:', origin);

    const proc = spawn({
      cmd: [binPath, origin],
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const decoder = new FrameDecoder();
    const incoming = new AsyncQueue<unknown>();

    // Drain stdout into the decoder, surface fully-formed messages on the queue.
    const stdoutPump = (async () => {
      const reader = proc.stdout.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          decoder.push(value);
          for (;;) {
            const msg = decoder.take();
            if (msg === null) break;
            incoming.push(msg);
          }
        }
        if (decoder.pending() > 0) {
          incoming.fail(
            new TransportError(
              `afproxy exited with ${decoder.pending()} unparsed bytes in its stdout buffer`,
            ),
          );
        } else {
          incoming.close();
        }
      } catch (err) {
        incoming.fail(
          err instanceof Error ? err : new TransportError(`stdout pump failed: ${String(err)}`),
        );
      }
    })();

    // Surface stderr only under --verbose.
    const stderrPump = (async () => {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder('utf-8');
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true }).trimEnd();
          if (text) trace('afproxy stderr:', text);
        }
      } catch {
        // stderr pump failures are non-fatal.
      }
    })();

    const exitPromise = proc.exited.then((code) => {
      Promise.all([stdoutPump, stderrPump]).catch(() => {});
      return code;
    });

    return new Afproxy(proc, decoder, incoming, exitPromise);
  }

  /** Send one message as a Native Messaging frame. */
  async send(message: unknown): Promise<void> {
    const frame = encodeFrame(message);
    const sink = this.proc.stdin as {
      write: (chunk: Uint8Array) => number;
      flush?: () => number | Promise<number>;
    };
    sink.write(frame);
    await sink.flush?.();
  }

  /**
   * Receive the next message from afproxy, or throw if the process exited
   * or the transport errored before a message arrived.
   */
  async recv(): Promise<unknown> {
    return this.incoming.take();
  }

  /** Send `request` and await one response. Convenience wrapper. */
  async roundtrip(request: unknown): Promise<unknown> {
    await this.send(request);
    return this.recv();
  }

  async close(): Promise<number> {
    try {
      const sink = this.proc.stdin as { end?: () => void | Promise<number> };
      sink.end?.();
    } catch (err) {
      warn('closing afproxy stdin:', err instanceof Error ? err.message : String(err));
    }
    return this.exitPromise;
  }
}

/**
 * Tiny single-consumer async queue. Enough for our one-pump-one-consumer
 * usage pattern; not a general-purpose concurrent queue.
 */
class AsyncQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;
  private error: Error | null = null;

  push(item: T): void {
    if (this.closed || this.error) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()!({ value: undefined as never, done: true });
    }
  }

  fail(err: Error): void {
    this.error = err;
    while (this.waiters.length > 0) {
      // Rejection is signalled through the next take() call below.
      this.waiters.shift()!({ value: undefined as never, done: true });
    }
  }

  async take(): Promise<T> {
    if (this.items.length > 0) return this.items.shift()!;
    if (this.error) throw this.error;
    if (this.closed) throw new TransportError('afproxy closed before a response arrived');
    return new Promise<T>((resolve, reject) => {
      this.waiters.push((r) => {
        if (this.error) reject(this.error);
        else if (r.done) reject(new TransportError('afproxy closed before a response arrived'));
        else resolve(r.value);
      });
    });
  }
}
