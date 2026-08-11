# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

### Releasing

Releases are automated via CI. To create a new release:

1. Add a new entry at the top of this file with heading `## [vX.Y.Z]` (without a
   date). This is a draft — it can be merged to `main` without triggering a
   release.
2. When ready to publish, update the heading to `## [vX.Y.Z] - YYYY-MM-DD` and
   merge to `main`. The date signals "ready to release".
3. The workflow will run tests, create a Git tag, GitHub Release, and npm publish.
4. If the tag already exists, the workflow skips (safe to re-merge).
5. If tests fail, no tag/release is created. The release will be re-attempted on
   each subsequent push to `main`, or can be manually retried from the Actions UI.

Stable versions (e.g. `v1.2.0`) publish to npm `@latest`. Pre-release versions
(e.g. `v1.2.0-rc.1`) publish to npm `@next` and create a GitHub pre-release.

## [v1.0.0] - 2026-08-11

Initial release. An independent, MIT-licensed CLI client for the
[Strongbox](https://strongboxsafe.com) password manager on macOS — a clean-room
implementation of its browser-autofill protocol (Native Messaging → `afproxy` →
Strongbox.app, libsodium Crypto Box).

### Commands

- `status` / `list` — server version and database state.
- `url <url>` — credentials matching a page URL (the extension's main query).
- `search [query]` — full-text search across unlocked databases; no query lists all.
- `get <ref> [--field <name>]` — one entry by UUID or exact title. `--field`
  prints a single value, including the current `totp` code and the raw
  `totp-uri` / `totp-secret` (e.g. for `oathtool`).
- `totp <ref>` — current TOTP code (RFC 6238, including Steam Guard).
- `copy <ref> [--field username|password|totp]` — copy a field to the OS
  clipboard via Strongbox.
- `add <title> [...]` — create an entry (title/username/password/url) in a
  chosen database and group; password via `--password`, `--password-stdin`, or
  `--generate`.
- `diagnose` — health-check the local Strongbox integration (app, process,
  Native Messaging manifest, live vault list), reading only system state and
  Strongbox's own outputs.

### Notes

- Output never prints secrets unless a secret field is explicitly requested;
  `--json` gives structured output, and stdout stays clean for pipelines.
- Editing and deleting entries are **not** supported — the protocol has no
  update or delete operation.
- macOS only, since Strongbox is an Apple-platform application.
