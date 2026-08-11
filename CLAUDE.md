# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Clean-room discipline (read before writing any code)

This is an **MIT-licensed clean-room implementation** of a protocol whose reference implementation (Strongbox) is **AGPL-3.0**. Those licences are incompatible for code derivation, so this project operates under a strict Chinese-wall rule:

- **Never read, quote, translate, or transliterate** code from `strongbox-password-safe/*` (notably `Strongbox` and `browser-autofill`). Not even to "check my answer".
- Protocol knowledge comes from **public sources only**: Strongbox's public KB articles, Chrome/Firefox Native Messaging specs, libsodium docs, and empirical wire observation (captures under `docs/captures/`).
- When the wire shape isn't yet known, say so. `docs/PROTOCOL.md` uses "TBD (observe)" for anything unconfirmed; mirror that discipline in code with `unknown` + runtime guards in `src/protocol/guards.ts`, not speculative type declarations.
- KeePassXC-Browser source is **fair game** for background (its licence situation differs and it's useful prior art). Strongbox source is not.

See `CONTRIBUTING.md` for the full rules. PRs that look source-derived get rejected regardless of correctness.

## Common commands

```sh
bun install                              # install deps (Bun 1.1+ required)
bun run dev -- <subcommand> [args]       # run the CLI from source
bun run typecheck                        # tsc --noEmit (strict mode, no any)
bun run lint                             # eslint src tests
bun run format                           # prettier --write src tests docs *.md
bun test                                 # unit tests (Bun's built-in runner)
bun test path/to/file.test.ts            # run one test file
bun test -t "pattern"                    # run tests whose name matches
bun run test:integration                 # integration tests; requires STRONGBOX_CLI_INTEGRATION=1 and a running Strongbox Pro on macOS
```

Integration tests under `tests/integration/` are skipped unless `STRONGBOX_CLI_INTEGRATION=1` is set — CI never sets this because no hosted runner can have Strongbox Pro installed.

## Architecture

The CLI impersonates the Strongbox browser extension. It reaches the running Strongbox.app through a three-hop chain; this code owns the first hop:

```
strongbox-cli ──(Native Messaging stdio)──▶ afproxy ──(AF_UNIX)──▶ Strongbox.app
```

### Layered source layout

- `src/cli.ts` — commander entry point. Registers subcommands, translates `StrongboxError` subclasses into exit codes (see `src/util/errors.ts`: 2=user, 3=environment, 4=not-running, 5=handshake, 6=transport, 7=protocol, 10=unimplemented).
- `src/commands/` — one file per subcommand. Use helpers from `_shared.ts`: `applyGlobalOpts`, `withSession` (opens+closes a `Session`), `emit` (honours `--json`), and the entry resolvers (`searchEntries`, `resolveEntry`, `publicView`). All subcommands work end to end: `diagnose`, `status`, `list`, `url`, `search`, `get`, `totp`, `copy`, `add`. There is no `edit`/`delete` — the protocol has no update op (see `docs/PROTOCOL.md` §5.5).
- `src/protocol/session.ts` — the high-level object commands talk to. Owns manifest lookup → identity load → Hello key exchange → encrypted RPC. Note afproxy is **one-shot**: it exits after replying, so every `rpc()` spawns its own process and `close()` is a no-op. The Hello response is cached at open, so `rpc(Hello)` costs nothing.
- `src/protocol/messages.ts` + `guards.ts` — outer envelope (`RequestEnvelope` / `ResponseEnvelope`) and inner-RPC (`RpcRequest` / `RpcResponse`) types, both observation-derived (see captures under `docs/captures/`). Runtime-validate anything coming off the wire through `guards.ts`; keep unknown fields as `unknown`, never `any`.
- `src/transport/manifest.ts` — walks per-browser `NativeMessagingHosts/` directories (Chrome, Chromium, Edge, Brave, Vivaldi, Arc, Firefox) and filters for manifests that list the Strongbox Chrome extension origin `chrome-extension://mnilpkfepdibngheginihjpknnopchbn/`.
- `src/transport/native-messaging.ts` — uint32-LE length-prefixed UTF-8 JSON framing. Outbound cap 1 MiB, inbound cap ~4 GiB per the spec. `FrameDecoder` is a streaming decoder; feed chunks with `push()`, pull complete messages with `take()`.
- `src/transport/afproxy.ts` — subprocess manager. Spawns the binary from the chosen manifest with one argv (the Chrome extension origin — we mimic Chrome's launch convention, not Firefox's). Pure transport: knows nothing about crypto or RPC vocabulary. stderr is surfaced only under `--verbose`.
- `src/crypto/box.ts` — typed wrapper over libsodium's `crypto_box_easy` / `crypto_box_open_easy` (Curve25519 + XSalsa20-Poly1305). Imported via `createRequire` to dodge a broken ESM build in `libsodium-wrappers-sumo` — if that's ever fixed upstream, revert to a plain default import.
- `src/crypto/identity.ts` — persists the client keypair at `~/Library/Application Support/strongbox-cli/identity.json` with 0600/0700 perms. Strongbox 1.63.1 was observed accepting an unseen client key with no approval prompt, so this is hygiene and future-proofing rather than a protocol requirement.
- `src/util/log.ts` — stderr-only logger gated by process-wide `setVerbose`. **stdout is reserved for command output**; diagnostics, trace, and warnings all go to stderr. Preserve this so shell pipelines stay clean.

### Output contract

Subcommands call `emit(value, asJson)`:

- default mode: strings go to stdout raw (with a trailing newline if absent); objects pretty-print as JSON.
- `--json`: everything pretty-prints as JSON.

Never print secrets unless the user explicitly asked for a secret field. One value per invocation by default so scripts can consume stdout directly.

## Code conventions

- **TypeScript `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.** Imports of `.ts` files must keep the extension (`allowImportingTsExtensions: true`).
- **No `any`.** Where the protocol shape is genuinely unknown, use `unknown` and narrow through a guard in `src/protocol/guards.ts`.
- **Throw typed errors.** Use a `StrongboxError` subclass from `src/util/errors.ts` so `cli.ts` maps it to the right exit code; raw `Error` throws fall through to exit 1.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`), subject ≤72 chars.
- Prettier: single-quote, semicolons on, trailing commas, `printWidth: 100`.

## Release automation

`CHANGELOG.md` is the release trigger (mechanism shared with `claude-aws-mfa`). `.github/workflows/release.yml` reads the **topmost** `## [vX.Y.Z]` heading — dated or not:

- No date → **draft**; mergeable to `main` without releasing.
- `## [vX.Y.Z] - YYYY-MM-DD` (date not in the future) and no existing tag → release: run the full `test.yml` matrix, then `npm publish` (stable → `@latest`, pre-release like `v1.2.0-rc.1` → `@next`), then create the tag + GitHub Release with the changelog body as notes.
- Already-tagged version at the top → skip silently (safe to re-merge). Publish happens **before** tagging, so a failed publish leaves no tag and retries on the next push.

`package.json`'s committed `version` is a placeholder (`0.0.0`); the changelog governs. npm publish uses **Trusted Publishing / OIDC** (`id-token: write`, no `NPM_TOKEN`); the release job checks out and tags with `secrets.RELEASE_PAT`.
