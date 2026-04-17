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
- CLI skeleton with `diagnose` (fully implemented), `status`, `list`, `search`,
  `get`, `url`, `totp` (stubs pending protocol capture).
