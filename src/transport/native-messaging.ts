/**
 * Chrome / Firefox Native Messaging wire framing.
 *
 * The framing is standardised and identical across Chrome and Firefox:
 *
 *   ┌───────────────┬─────────────────────────────────────────────┐
 *   │ uint32 length │ UTF-8 JSON body, `length` bytes long        │
 *   └───────────────┴─────────────────────────────────────────────┘
 *
 * The length prefix is in **native byte order**, which on every platform
 * Strongbox supports (x86_64 / arm64 macOS) is little-endian.
 *
 * Size limits from the spec:
 *   - extension -> host: 1 MiB per message
 *   - host -> extension: 4 GiB per message
 *
 * We enforce the smaller limit outbound and the larger limit inbound by
 * default, because we impersonate the extension end.
 *
 * References:
 *   https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
 *   https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging
 */

import { ProtocolError } from '../util/errors.ts';

const MAX_OUTBOUND_BYTES = 1024 * 1024; // 1 MiB
const MAX_INBOUND_BYTES = 4 * 1024 * 1024 * 1024 - 1; // 4 GiB - 1

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Encode a single message as a Native Messaging frame. Caller is responsible
 * for writing the resulting bytes to the subprocess stdin in one go (or at
 * least without interleaving other frames).
 */
export function encodeFrame(message: unknown): Uint8Array {
  const json = JSON.stringify(message);
  const body = textEncoder.encode(json);
  if (body.byteLength > MAX_OUTBOUND_BYTES) {
    throw new ProtocolError(
      `outbound message is ${body.byteLength} bytes; max is ${MAX_OUTBOUND_BYTES}`,
    );
  }
  const frame = new Uint8Array(4 + body.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, body.byteLength, /* littleEndian */ true);
  frame.set(body, 4);
  return frame;
}

/**
 * Streaming decoder: you feed it arbitrary chunks of bytes as they arrive on
 * stdin, and call `take()` to pull fully-assembled JSON messages out.
 */
export class FrameDecoder {
  private buf: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.buf.byteLength + chunk.byteLength);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.byteLength);
    this.buf = merged;
  }

  take(): unknown | null {
    if (this.buf.byteLength < 4) return null;
    const view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    const length = view.getUint32(0, /* littleEndian */ true);
    if (length > MAX_INBOUND_BYTES) {
      throw new ProtocolError(`inbound frame claims ${length} bytes; exceeds ${MAX_INBOUND_BYTES}`);
    }
    if (this.buf.byteLength < 4 + length) return null;
    const body = this.buf.subarray(4, 4 + length);
    const json = textDecoder.decode(body);
    this.buf = this.buf.subarray(4 + length);
    try {
      return JSON.parse(json);
    } catch (err) {
      throw new ProtocolError(
        `frame body was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Number of bytes buffered but not yet emitted as a complete frame. */
  pending(): number {
    return this.buf.byteLength;
  }
}
