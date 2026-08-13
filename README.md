# strongbox-cli

A clean-room, independent CLI client for the [Strongbox](https://strongboxsafe.com/) password manager on macOS, built on [Bun](https://bun.sh).

Query your running, already-unlocked Strongbox from the shell — the same way the browser extension does, without handing your master password to a script.

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

All payloads between the extension and the app are encrypted with a libsodium "Crypto Box" (Curve25519 + XSalsa20-Poly1305) using an ephemeral keypair. See [`docs/PROTOCOL.md`](docs/PROTOCOL.md) for the full model.

This CLI impersonates the browser extension: it spawns `afproxy` with the browser extension's identity, exchanges keys, and issues the same RPCs the extension does.

## Legal / licensing

- This project is **MIT-licensed** (see [LICENSE](LICENSE)).
- The protocol notes in `docs/` are derived from Strongbox's **public documentation**, observable system behaviour (file paths, Native Messaging manifests, wire traffic), and standards (Chrome Native Messaging, libsodium sealed boxes, KeePass). They do **not** come from reading Strongbox's AGPL source.
- Contributors: please do not reference, quote, or translate code from `strongbox-password-safe/*` repositories into this project. If you've read that code recently, recuse yourself from protocol work for a reasonable cooling-off period. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
- Strongbox and the Strongbox logo are trademarks of Mark McGuill. This project is not affiliated with or endorsed by Strongbox.

## Requirements

- macOS (Strongbox only runs on Apple platforms).
- A Pro licence of Strongbox (the browser-extension IPC is a Pro feature).
- Bun 1.1+.

## Install

Requires the [Bun](https://bun.sh) runtime.

```sh
bun install -g strongbox-cli
```

Or run without installing: `bunx strongbox-cli --help`.

## Commands

```sh
strongbox-cli status                         # server version + database state
strongbox-cli list                           # unlocked databases
strongbox-cli search [query]                 # full-text search (no query lists all)
strongbox-cli url <url>                       # credentials for a page URL
strongbox-cli get <ref> [--field <name>]      # one entry by UUID or title
strongbox-cli get <ref> --reveal              # ...with all secret fields shown
strongbox-cli get <ref> --database <db>        # ...restricted to one vault
strongbox-cli totp <ref>                      # current TOTP code (incl. Steam)
strongbox-cli copy <ref> [--field <name>]     # copy a field to the clipboard
strongbox-cli add <title> [...]               # create an entry
strongbox-cli unlock <db>                     # prompt for a vault's password
strongbox-cli lock <db>                       # lock a vault
strongbox-cli diagnose                        # health-check the integration
```

`search`, `get`, `totp`, and `copy` take `--database <nickname|uuid>` to restrict the lookup to one vault. Because a locked vault contributes no entries to any query, naming one is an error (exit 4, `database … is locked`) rather than a silent no-match.

Locked vaults can only be opened by Strongbox itself, which owns the master-password / biometric prompt: `unlock <db>` asks it to raise that prompt and blocks until you answer — exit 0 once unlocked, exit 4 if you cancel. `get --database <db> --unlock` does the same inline, then runs the lookup. Nothing about your master password ever passes through this CLI.

By default `get` hides secret fields. `get <ref> --reveal` prints the full record (password, TOTP URI, notes, custom-field values); `get <ref> --field <name>` prints one value — `password`, `notes`, a custom-field key, or `totp` (live code), `totp-uri`, `totp-secret` (e.g. for `oathtool`). The entry icon (a multi-KB data URI) is omitted from record views unless you pass `--icon`. `--json` gives structured output. Editing and deleting entries are not supported — the protocol has no update or delete operation.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the clean-room rules, and [`docs/PROTOCOL.md`](docs/PROTOCOL.md) for the protocol.
