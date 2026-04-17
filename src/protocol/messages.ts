/**
 * Protocol message types.
 *
 * **Every concrete shape in this file is a hypothesis until confirmed by wire
 * capture.** See docs/PROTOCOL.md and docs/REVERSE_ENGINEERING.md.
 *
 * We intentionally keep this file small and use `unknown` + runtime schema
 * validation for anything we haven't nailed down. Do not guess field names
 * by pattern-matching against similar products — record what's actually on
 * the wire, then update this file.
 *
 * The design here splits the protocol into two layers:
 *
 *   (1) Outer frames that ride on Native Messaging stdio. The outer frame is
 *       either a plaintext handshake message or an encrypted envelope.
 *
 *   (2) Inner RPC payloads that are carried inside the encrypted envelope.
 *       These are the `get-credentials`, `list-databases`, etc. calls.
 *
 * As we learn the real shapes, replace `unknown` below with concrete types
 * and add runtime guards in `./guards.ts`.
 */

/* ─── Outer layer (on the Native Messaging wire) ───────────────────────── */

/**
 * Hypothetical outer-frame discriminant. Real discriminant field name TBD.
 * The two expected cases are a plaintext handshake message and an encrypted
 * envelope carrying an inner RPC.
 */
export type OuterFrame = HandshakeFrame | EnvelopeFrame;

/**
 * Plaintext handshake frame. Shape TBD; this is a placeholder so the rest of
 * the codebase can compile.
 */
export interface HandshakeFrame {
  readonly kind: 'handshake';
  readonly payload: unknown;
}

/**
 * Encrypted envelope. Shape TBD. Expected to carry at minimum the nonce and
 * the ciphertext; possibly also a request/response correlation ID at the
 * outer layer rather than inside the plaintext.
 */
export interface EnvelopeFrame {
  readonly kind: 'envelope';
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

/* ─── Inner layer (inside the encrypted envelope) ──────────────────────── */

/**
 * Hypothetical inner request. Field names, casing, and the `op` vocabulary
 * are all TBD.
 */
export interface RpcRequest<Op extends string = string, Args = unknown> {
  readonly id: string;
  readonly op: Op;
  readonly args: Args;
}

export interface RpcResponseOk<Result = unknown> {
  readonly id: string;
  readonly ok: true;
  readonly result: Result;
}

export interface RpcResponseErr {
  readonly id: string;
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
}

export type RpcResponse<Result = unknown> = RpcResponseOk<Result> | RpcResponseErr;

/* ─── Op names ─────────────────────────────────────────────────────────── */

/**
 * Expected RPC operations, based on what the browser extension visibly does.
 * Actual string values are TBD.
 */
export const Op = {
  status: 'status',
  listDatabases: 'list-databases',
  search: 'search',
  getEntry: 'get-entry',
  getCredentialsForUrl: 'get-credentials-for-url',
  getTotp: 'get-totp',
} as const;

export type OpName = (typeof Op)[keyof typeof Op];
