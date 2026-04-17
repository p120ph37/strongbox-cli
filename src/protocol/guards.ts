/**
 * Runtime type guards for protocol messages.
 *
 * Because the wire shapes are discovered, not specified, everything we pull
 * off the wire is `unknown` until it passes one of these guards. Each guard
 * checks only the fields it needs; it does not assume unknown fields are
 * absent (forward-compatibility: Strongbox may add fields over time).
 */

import type { OuterFrame, HandshakeFrame, EnvelopeFrame, RpcResponse } from './messages.ts';

export function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function isString(x: unknown): x is string {
  return typeof x === 'string';
}

export function isHandshakeFrame(x: unknown): x is HandshakeFrame {
  return isObject(x) && x['kind'] === 'handshake';
}

export function isEnvelopeFrame(x: unknown): x is EnvelopeFrame {
  // TBD: once we have real captures we'll know whether nonce/ciphertext are
  // base64 strings, hex strings, or something else on the wire. Until then,
  // this guard is permissive and the caller is responsible for decoding.
  return isObject(x) && x['kind'] === 'envelope';
}

export function isOuterFrame(x: unknown): x is OuterFrame {
  return isHandshakeFrame(x) || isEnvelopeFrame(x);
}

export function isRpcResponse(x: unknown): x is RpcResponse {
  if (!isObject(x)) return false;
  if (!isString(x['id'])) return false;
  if (x['ok'] === true) return true;
  if (x['ok'] === false) {
    const err = x['error'];
    return isObject(err) && isString(err['code']) && isString(err['message']);
  }
  return false;
}
