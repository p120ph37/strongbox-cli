# strongbox-cli

A clean-room, independent CLI client for the [Strongbox](https://strongboxsafe.com/) password manager on macOS, built on [Bun](https://bun.sh).

**Status:** early bootstrap / protocol reverse-engineering phase. Nothing works yet.

## Goals

- Provide a `bitwarden`/`keepassxc-cli`-style command-line interface for querying a running, already-unlocked Strongbox instance.
- Avoid requiring the user to hand the master password to a script — piggyback on the existing, trusted, biometric-unlocked Strongbox session the same way the browser extension does.
- Be scriptable: stdout is clean, errors go to stderr, exit codes are meaningful.
- Be an MIT-licensed, independent implementation. No code is copied, translated, or derived from Strongbox's own AGPL-licensed sources.

## Non-goals

- We are **not** reimplementing KDBX parsing. If you want to read the `.kdbx` file directly with your own master password, use [`pykeepass`](https://github.com/libkeepass/pykeepass), [`gokeepasslib`](https://github.com/tobischo/gokeepasslib), or `keepassxc-cli`. This project is specifically for talking to a running Strongbox app.
- We are not targeting iOS (the on-device IPC surface doesn't exist there in the same way).
- We are not shipping a GUI.

## Approach

Strongbox's browser extension talks to the macOS app through a three-hop chain:

```
browser extension  ──(Native Messaging / stdio)──▶  afproxy  ──(Unix socket)──▶  Strongbox.app
```

All payloads between the extension and the app are encrypted with a libsodium "Crypto Box" (Curve25519 + XSalsa20-Poly1305) using an ephemeral keypair. See [`docs/PROTOCOL.md`](docs/PROTOCOL.md) for the full model and what's known vs. what we need to determine empirically.

This CLI impersonates the browser extension: it spawns `afproxy` with the browser extension's identity, completes the handshake, and issues the same RPCs the extension does.

## Legal / licensing

- This project is **MIT-licensed** (see [LICENSE](LICENSE)).
- The protocol notes in `docs/` are derived from Strongbox's **public documentation**, observable system behaviour (file paths, Native Messaging manifests, wire traffic), and standards (Chrome Native Messaging, libsodium sealed boxes, KeePass). They do **not** come from reading Strongbox's AGPL source.
- Contributors: please do not reference, quote, or translate code from `strongbox-password-safe/*` repositories into this project. If you've read that code recently, recuse yourself from protocol work for a reasonable cooling-off period. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
- Strongbox and the Strongbox logo are trademarks of Mark McGuill. This project is not affiliated with or endorsed by Strongbox.

## Requirements

- macOS (Strongbox only runs on Apple platforms).
- A Pro licence of Strongbox (the browser-extension IPC is a Pro feature).
- Bun 1.1+.

## Quickstart

```sh
bun install
bun run build
./bin/strongbox-cli --help
```

Nothing past `--help` is wired up yet. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Planned command surface

```sh
strongbox-cli status                         # handshake + ping
strongbox-cli list                           # enumerate unlocked databases
strongbox-cli search <query>                 # fuzzy match titles
strongbox-cli get <entry-ref> [--field=...]  # retrieve one field
strongbox-cli url <url>                      # extension-style URL match
strongbox-cli totp <entry-ref>               # current TOTP code
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/REVERSE_ENGINEERING.md`](docs/REVERSE_ENGINEERING.md).

## Releases

Releases are cut automatically from `CHANGELOG.md` by `.github/workflows/release.yml` when a heading of the form `## [vX.Y.Z] - YYYY-MM-DD` lands on `main`. The workflow:

1. Parses the changelog, validates the version is semver with a `v` prefix and the date is today (UTC ±12h).
2. Runs the reusable build (typecheck, build, tests on Linux + macOS).
3. Creates the git tag and a GitHub Release whose notes are the changelog entry body.
4. Publishes to npm using **trusted publishing via OIDC** — no long-lived `NPM_TOKEN` secret. Provenance attestations are generated automatically and verifiable with `npm audit signatures`.

### One-time setup on npmjs.com

Before the first release can run successfully, configure a Trusted Publisher for the package at https://www.npmjs.com/package/strongbox-cli/access:

- Provider: **GitHub Actions**
- Organization or user: **p120ph37**
- Repository: **strongbox-cli**
- Workflow filename: **release.yml**
- Environment name: *(leave blank)*

Note: the Trusted Publisher rule can't be configured for a package that doesn't exist yet on npm. For the very first publish you have two options:

1. **Park a placeholder first.** Publish a minimal `0.0.0` version manually with a local `npm publish`, then configure the Trusted Publisher, then let CI take over from `0.0.1` onward.
2. **Use one-time token auth for the first release only.** Temporarily add an `NPM_TOKEN` secret and a `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` env line to the publish step, run it once, then delete both and configure the Trusted Publisher before the next release.

### Required repository secrets

- `RELEASE_PAT` — a Personal Access Token with `contents: write` and `workflow: write` scopes on this repo, used to push the git tag from the release job. (The default `GITHUB_TOKEN` can't push to a protected branch with tag-protection rules.) No `NPM_TOKEN` is needed once Trusted Publishing is configured.
