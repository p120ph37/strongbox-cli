# 2026-08-10 — direct CLI captures (mt=1, mt=14)

Plaintext for the two messageTypes the browser extension never drives
during normal use but that are reachable over the same protocol:

- **mt=1 `SearchRequest`** — generic full-text search, the schema gap
  that blocked the `search` command.
- **mt=14 `GetFavouritesRequest`** — the favourites list.

## How these were captured

Unlike the `2026-04-20-layerD/` set (which used a back-to-back-encryption
MitM), these came **straight from this project's own client** talking to
the real `afproxy`. Once the encrypted RPC path worked (`src/protocol/
session.ts`), a capture just means sealing a request, sending it, and
recording the decrypted reply — no interposer needed. `mt=1`'s field name
(`query`) was recovered by guess-and-check against the server's decode
error, not by reading Strongbox source.

Because there is no MitM, `meta.txt` records the CLI's own persisted
client public key and the real server public key, rather than a pair of
impersonated keypairs.

## What was elided / omitted

- **Icons.** Every `Credential.icon` is a multi-KB `data:image/png;base64,…`
  URI; replaced with `"<PNG-base64 elided>"`.
- **`in.hex` / `out.hex` omitted.** The raw envelope framing is already
  documented by `2026-04-17-envelope/` and `2026-04-20-layerD/`; the
  response frames here are tens of KB of opaque ciphertext (mostly the
  elided icons) with no additional documentary value. Only the decrypted
  `plaintext.jsonl` is kept.

## Contents are synthetic

Both captures are against the throwaway `test` vault. The `Sentinel Entry`
was purpose-built to exercise every `Credential` field at once (tags,
custom fields incl. a concealable one, TOTP, notes, attachments,
favourite); `Sample` is Strongbox's default sample entry. No real
credentials, and the machine's other (locked) database contributes nothing
to either reply.

## Capture index

| dir                   | mt  | operation                                                |
| --------------------- | --- | -------------------------------------------------------- |
| `01-mt1-search-all/`  | 1   | `{"query":""}` → all test-vault entries (only 2 present) |
| `02-mt14-favourites/` | 14  | `{}` → favourited entries                                |

Note: this `01-` capture returned both `test`-vault entries because that vault
held only two. `query: ""` does **not** return an entire large database in one
response — `take` is clamped to ~64 server-side and full enumeration requires
`skip` paging. See PROTOCOL.md §5.1a.

See `docs/PROTOCOL.md` §5.1a (mt=1) and §5.11 (mt=14) for the schemas, and
§5.6 for the protocol-level field filtering these captures revealed.
