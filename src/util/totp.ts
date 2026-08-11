/**
 * Compute a TOTP code from an `otpauth://` URI (RFC 6238).
 *
 * Strongbox returns the shared secret as an `otpauth://totp/...` URI in a
 * `Credential.totp` field rather than a live code, so the client derives the
 * digits. `node:crypto` provides the HMAC; the rest is base32 decoding and
 * the RFC 6238 dynamic-truncation step.
 */
import { createHmac } from 'node:crypto';
import { UserError } from './errors.ts';

/** Decode an RFC 4648 base32 string (A–Z2–7, padding optional) to bytes. */
function base32Decode(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw new UserError(`invalid base32 character in TOTP secret: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

interface OtpParams {
  secret: string;
  algorithm: string;
  digits: number;
  period: number;
  /** Non-standard code alphabet. `"steam"` = Steam Guard; undefined = numeric. */
  encoder: string | undefined;
}

/** Steam Guard's 5-symbol alphabet (RFC 6238 truncation, base-26 into these). */
const STEAM_ALPHABET = '23456789BCDFGHJKMNPQRTVWXY';

/** Parse the query parameters we need out of an `otpauth://totp/...` URI. */
export function parseOtpauth(uri: string): OtpParams {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new UserError(`entry TOTP is not a valid otpauth URI`);
  }
  if (url.protocol !== 'otpauth:' || url.host !== 'totp') {
    throw new UserError(`entry TOTP is not an otpauth://totp URI`);
  }
  const secret = url.searchParams.get('secret');
  if (!secret) throw new UserError('entry TOTP URI has no secret');
  return {
    secret,
    algorithm: (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase(),
    digits: Number(url.searchParams.get('digits') ?? '6'),
    period: Number(url.searchParams.get('period') ?? '30'),
    encoder: url.searchParams.get('encoder')?.toLowerCase() ?? undefined,
  };
}

/**
 * Current TOTP code for an `otpauth://` URI. `nowMs` is injectable so the
 * computation is testable against RFC 6238 vectors.
 */
export function totpFromUri(uri: string, nowMs: number): string {
  const { secret, algorithm, digits, period, encoder } = parseOtpauth(uri);
  const key = base32Decode(secret);

  const counter = Math.floor(nowMs / 1000 / period);
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter. Bun/Node support BigInt writes.
  buf.writeBigUInt64BE(BigInt(counter));

  const algo =
    algorithm === 'SHA1'
      ? 'sha1'
      : algorithm === 'SHA256'
        ? 'sha256'
        : algorithm === 'SHA512'
          ? 'sha512'
          : null;
  if (!algo) throw new UserError(`unsupported TOTP algorithm: ${algorithm}`);

  const hmac = createHmac(algo, key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  if (encoder === 'steam') {
    // Steam Guard: same truncation, but emit 5 symbols base-26 into its
    // alphabet (least-significant first) instead of decimal digits.
    let v = binary;
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += STEAM_ALPHABET[v % STEAM_ALPHABET.length];
      v = Math.floor(v / STEAM_ALPHABET.length);
    }
    return code;
  }

  return (binary % 10 ** digits).toString().padStart(digits, '0');
}
