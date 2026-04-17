import { describe, expect, test } from 'bun:test';
import { encodeFrame, FrameDecoder } from '../src/transport/native-messaging.ts';
import { ProtocolError } from '../src/util/errors.ts';

describe('Native Messaging framing', () => {
  test('roundtrips a simple message', () => {
    const msg = { hello: 'world', n: 42 };
    const frame = encodeFrame(msg);

    const dec = new FrameDecoder();
    dec.push(frame);
    expect(dec.take()).toEqual(msg);
    expect(dec.take()).toBeNull();
    expect(dec.pending()).toBe(0);
  });

  test('length prefix is uint32 little-endian', () => {
    const msg = { a: 1 };
    const frame = encodeFrame(msg);
    const json = JSON.stringify(msg);
    const expectedLen = new TextEncoder().encode(json).byteLength;
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    expect(view.getUint32(0, true)).toBe(expectedLen);
    // Confirm it's *not* big-endian by spot-checking a multi-byte length.
    const big = { x: 'a'.repeat(300) };
    const bigFrame = encodeFrame(big);
    const bigView = new DataView(bigFrame.buffer, bigFrame.byteOffset, bigFrame.byteLength);
    expect(bigView.getUint32(0, true)).toBeGreaterThan(300);
    expect(bigView.getUint32(0, false)).not.toBe(bigView.getUint32(0, true));
  });

  test('decodes multiple frames pushed at once', () => {
    const a = encodeFrame({ n: 1 });
    const b = encodeFrame({ n: 2 });
    const c = encodeFrame({ n: 3 });
    const combined = new Uint8Array(a.byteLength + b.byteLength + c.byteLength);
    combined.set(a, 0);
    combined.set(b, a.byteLength);
    combined.set(c, a.byteLength + b.byteLength);

    const dec = new FrameDecoder();
    dec.push(combined);
    expect(dec.take()).toEqual({ n: 1 });
    expect(dec.take()).toEqual({ n: 2 });
    expect(dec.take()).toEqual({ n: 3 });
    expect(dec.take()).toBeNull();
  });

  test('reassembles frames split across arbitrary chunk boundaries', () => {
    const msg = { data: 'x'.repeat(1000) };
    const frame = encodeFrame(msg);

    const dec = new FrameDecoder();
    // Split into one-byte chunks to stress the partial-read path.
    for (let i = 0; i < frame.byteLength; i++) {
      dec.push(frame.subarray(i, i + 1));
    }
    expect(dec.take()).toEqual(msg);
  });

  test('returns null while waiting for more bytes', () => {
    const frame = encodeFrame({ hello: 'world' });
    const dec = new FrameDecoder();
    dec.push(frame.subarray(0, 2)); // only half the length prefix
    expect(dec.take()).toBeNull();
    dec.push(frame.subarray(2, 4)); // complete length prefix, no body
    expect(dec.take()).toBeNull();
    dec.push(frame.subarray(4)); // body
    expect(dec.take()).toEqual({ hello: 'world' });
  });

  test('handles UTF-8 multibyte content correctly', () => {
    const msg = { greeting: 'こんにちは 🌍' };
    const frame = encodeFrame(msg);
    const dec = new FrameDecoder();
    dec.push(frame);
    expect(dec.take()).toEqual(msg);
  });

  test('rejects outbound messages over 1 MiB', () => {
    // 1 MiB of 'x' plus JSON overhead blows the limit.
    const oversized = { data: 'x'.repeat(1024 * 1024 + 10) };
    expect(() => encodeFrame(oversized)).toThrow(ProtocolError);
  });

  test('rejects inbound frames with malformed JSON', () => {
    const badJson = new TextEncoder().encode('{not json');
    const frame = new Uint8Array(4 + badJson.byteLength);
    new DataView(frame.buffer).setUint32(0, badJson.byteLength, true);
    frame.set(badJson, 4);

    const dec = new FrameDecoder();
    dec.push(frame);
    expect(() => dec.take()).toThrow(ProtocolError);
  });
});
