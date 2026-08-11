/**
 * RFC 6238 Appendix B test vectors (SHA1 seed "12345678901234567890",
 * base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 8 digits, 30s period).
 */
import { expect, test } from 'bun:test';
import { totpFromUri } from '../src/util/totp.ts';

const uri =
  'otpauth://totp/test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&algorithm=SHA1&digits=8&period=30';

test.each([
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [20000000000, '65353130'],
])('RFC 6238 vector at t=%d', (seconds, expected) => {
  expect(totpFromUri(uri, seconds * 1000)).toBe(expected);
});

// Steam Guard: same HMAC/truncation, 5 symbols base-26 over Steam's alphabet.
// Golden values derived from our implementation after it was verified to match
// Strongbox's own mt=3 code (`J2DCB`) live; this locks the steam branch.
test.each([
  [59000, '2YXGV'],
  [1111111109000, 'CWDGV'],
  [1700000000000, '2KM2P'],
])('Steam encoder at t=%d', (ms, expected) => {
  const uri =
    'otpauth://totp/Steam:acct?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1&encoder=steam&digits=5&period=30';
  const code = totpFromUri(uri, ms);
  expect(code).toBe(expected);
  expect(code).toMatch(/^[23456789BCDFGHJKMNPQRTVWXY]{5}$/);
});

test('SHA256 vector at t=59', () => {
  // 32-byte seed "12345678901234567890123456789012" in base32.
  const sha256 =
    'otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA&algorithm=SHA256&digits=8&period=30';
  expect(totpFromUri(sha256, 59_000)).toBe('46119246');
});
