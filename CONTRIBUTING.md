# Contributing

The one thing that matters here is the licensing discipline below. Everything
else (style, commits, tests) is described in `CLAUDE.md`.

## Clean-room discipline

This project is MIT-licensed but speaks to Strongbox, whose source is AGPL-3.0.
Those licences are incompatible for code derivation, so the implementation must
be written from an observed spec, never from Strongbox's source:

- **Protocol knowledge comes from public sources and wire observation only** —
  Strongbox's public KB, the Native Messaging / libsodium / KeePass specs, and
  traffic you capture yourself. `docs/PROTOCOL.md` is such a spec; it cites
  public sources, never files or line numbers in `strongbox-password-safe/*`.
- **Never read, quote, translate, or transliterate** code from the Strongbox or
  `browser-autofill` sources into this project. If you've read them recently,
  document protocol findings only, or let some time pass before writing
  implementation code for the same subsystem.
- Where the wire shape isn't known, say so (`unknown` + a runtime guard), rather
  than guessing from source.

PRs that appear to derive from AGPL sources will be rejected regardless of
correctness — it's the only way this project can ship under MIT.
