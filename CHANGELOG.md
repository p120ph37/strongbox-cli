# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/), and this
project aims to follow [Semantic Versioning](https://semver.org/).

Release automation (see `.github/workflows/release.yml`) looks for the first
heading that matches `## [vX.Y.Z] - YYYY-MM-DD` and cuts a tagged release
against it. Drafts in progress should use a date-less `## [vX.Y.Z]` heading
so they don't trigger the release workflow.

## [vNext]

Draft notes for the next release go here. When you're ready to ship, add a
date to this heading in the form `## [vX.Y.Z] - YYYY-MM-DD`.

### Added

- Project bootstrap: MIT-licensed, clean-room-disciplined scaffold for an
  independent CLI client against the Strongbox `afproxy` protocol.
- Public-source protocol notes (`docs/PROTOCOL.md`) and reverse-engineering
  methodology (`docs/REVERSE_ENGINEERING.md`).
- Working Native Messaging framing codec.
- Manifest discovery across Chrome, Chromium, Edge, Brave, Vivaldi, Arc, Firefox.
- libsodium Crypto Box wrapper and persistent client identity.
- CLI subcommands: `diagnose`, `status`, `list`, `url`, `search`, `get`, `totp`,
  `copy` (all working). `add`/`edit` remain unimplemented (M6).
- `diagnose` reworked into a layered health check: Strongbox.app installed,
  process running (`pgrep`), Native Messaging manifest present (its absence
  reported as "browser-autofill extension feature is OFF"), afproxy path, and a
  live Hello enumerating vaults with each one's queryability (locked / AutoFill
  disabled / queryable). It observes system state and Strongbox's outputs only
  — it never reads Strongbox's preference or database files.
- Working encrypted session: `Session.open()` performs the `messageType=0`
  key exchange and `Session.rpc()` seals, sends, decrypts, and shape-checks
  each RPC, all round-tripping against a real Strongbox (verified against
  1.64.2). `rpc()` now also enforces a 10 s reply deadline instead of hanging.
- `search`, `get`, `totp`, and `copy` are implemented, all riding on `mt=1`
  search. `search`/`get`/`totp` page the full result set on `skip` (the server
  clamps `take` to ~64, so a single request silently truncates a large vault);
  `get`/`totp` resolve a ref by full-text search, falling back to a paged
  enumeration for UUIDs since search does not index them. `totp` derives the
  live code from the entry's `otpauth://` URI (RFC 6238, `src/util/totp.ts`) —
  verified to match Strongbox's own server-side code. `copy` uses `mt=3`
  CopyField to place username/password/TOTP on the OS clipboard (autotype for
  non-browser targets). Default output omits secrets — password, TOTP, notes,
  and custom-field values are reachable only via `get --field` or `copy`.
- TOTP secret export: `get --field totp-uri` prints the raw `otpauth://` URI and
  `get --field totp-secret` the Base32 seed — values Strongbox's UI hides but
  ships in the record. Cross-checked against `oathtool -b <exported-secret>`.
- Steam Guard TOTP support: `src/util/totp.ts` special-cases `encoder=steam`
  (5-symbol base-26 alphabet). Verified digit-for-digit against Strongbox's own
  mt=3 code for both a pasted KeePassXC Steam URL and Strongbox's native Steam
  mode; regression vectors in `tests/totp.test.ts`.
- `SessionOptions.manifestPathOverride` is honoured, which lets tests point
  the session at the fake afproxy in `tests/fixtures/`.
- Captures confirming the entry record and two new messageTypes: three
  non-empty `CredentialsForUrl` results (`10-`–`12-` under
  `docs/captures/2026-04-20-layerD/`) and the `mt=1`/`mt=14` schemas
  (`docs/captures/2026-08-10-direct/`). `results` is now typed `Credential[]`
  with a per-element guard, and `customFields` is typed `{key,value,concealable}[]`.

### Fixed

- `Credential.totp` documented as what it is — an `otpauth://` URI carrying
  the shared secret, not a live code. A `totp` command needs no messageType
  of its own.
- Noted that `unlockedDatabaseCount` counts unlocked databases rather than
  results, that mt=2 matching is host-scoped rather than path-scoped, and
  that result ordering is not stable between calls.
- Corrected the mt=4 / mt=5 rows in the Layer-D capture index, which still
  had the pre-`93b0b9f` lock/unlock labels.
- Documented that the response is a *filtered* view of the entry (§5.6): SSH
  attachments, reserved custom-field keys, the `Favorite` tag, and the Recycle
  Bin are withheld — so `attachmentFileNames` cannot reveal an entry's SSH key.
- `concealable` on a custom field is a display hint only; the value is sent in
  the clear.
- Transport §3 completed: `F` confirmed as the afproxy⇄Strongbox socket, its
  framing recorded as bare JSON, and direct-to-`F` shown possible but not
  adopted. The §6 SSH-agent section now documents the KeeAgent storage model
  and how to reach `agent.sock`.
- mt=3 CopyField characterised (§5.3): it writes to the OS **clipboard**, not
  the keyboard-injection path an earlier draft assumed; the `field` enum is
  `0=username, 1=password, 2=TOTP` (the old `2=password` was wrong).
- mt=1 `take` documented as clamped to ~64 server-side, with `skip` paging as
  the only way to read a full database. An earlier note that `query: ""`
  returns every entry was corrected — it was an artifact of a 2-entry vault.
