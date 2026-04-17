# Roadmap

Milestones are ordered by "what unblocks what", not by calendar time.

## M0 — Bootstrap (this commit)

- [x] Project skeleton, TypeScript, Bun, MIT licence.
- [x] Clean-room contribution rules.
- [x] Protocol doc with clear "known" vs. "TBD" split.
- [x] Reverse-engineering methodology doc.
- [x] CLI stub with `--help` and `--version`.

## M1 — Discovery

- [ ] Locate the Strongbox Native Messaging manifest on disk. Implement `src/transport/manifest.ts` (pure file-system lookup, no afproxy invocation).
- [ ] `strongbox-cli diagnose` command: prints manifest path, manifest contents, afproxy path, existence of the group container, permissions, etc. Useful both for us during development and for users debugging later.
- [ ] Commit first Layer-A captures under `docs/captures/` covering at minimum: extension startup, one `get-credentials-for-url`, and a successful autofill.

## M2 — Transport

- [ ] Native Messaging framing codec (`src/transport/native-messaging.ts`): uint32-LE length prefix over UTF-8 JSON. Unit tested with fixtures in `tests/fixtures/native-messaging/`.
- [ ] Process manager (`src/transport/afproxy.ts`): spawn afproxy with correct argv, pipe stdio, surface errors, clean shutdown on SIGINT / process exit.
- [ ] End-to-end plaintext ping test: can we get *any* response from a real afproxy with no crypto layer yet? (Probably not, since it'll expect a handshake — but confirming the failure mode is itself a data point.)

## M3 — Crypto

- [ ] `src/crypto/box.ts`: thin wrapper over `libsodium-wrappers-sumo` with the specific `crypto_box_easy` / `crypto_box_open_easy` signatures we need. Typed. Nonce generation strategy pluggable (random / counter), defaulted per the observed protocol.
- [ ] Keypair persistence (`src/crypto/identity.ts`): store our client keypair at `~/Library/Application Support/strongbox-cli/identity.json` with 0600 perms. Rotate on request.
- [ ] Handshake implementation matching whatever captures in M1 showed.

## M4 — First RPC

- [ ] `strongbox-cli status`: opens a session, completes the handshake, sends the status RPC, prints result. This is the "one end-to-end path works" milestone.
- [ ] Integration test harness: `STRONGBOX_CLI_INTEGRATION=1 bun test tests/integration/` runs against a real Strongbox; otherwise skipped.

## M5 — Read commands

- [ ] `strongbox-cli list`
- [ ] `strongbox-cli search <query>`
- [ ] `strongbox-cli get <ref> [--field=password|username|totp|url|notes|<custom>]`
- [ ] `strongbox-cli url <url>` — the extension's main call.
- [ ] `strongbox-cli totp <ref>`

Output rules: one value per invocation by default (scriptable); `--json` for structured output; never print secrets unless explicitly asked for a secret field.

## M6 — Write commands (conditional)

Only if the protocol actually supports it and users ask for it:

- [ ] `strongbox-cli add`
- [ ] `strongbox-cli edit`

Write paths need extra care around conflict resolution. Defer until read paths are solid.

## M7 — Ergonomics

- [ ] Shell completions (bash, zsh, fish).
- [ ] `--watch` / long-lived session for scripts that need many lookups.
- [ ] Optional SSH-agent passthrough (`strongbox-cli ssh-agent`) — probably a thin wrapper that just verifies the symlink at `~/.strongbox/agent.sock` exists and points where it should.

## M8 — Distribution

- [ ] Homebrew tap.
- [ ] Single-file compiled binary via `bun build --compile`.
- [ ] GitHub release workflow.

## Non-timeline

Windows and Linux support are not on the roadmap because Strongbox only runs on Apple platforms.

iOS support is not on the roadmap because the on-device IPC surface is different (app extensions, not Unix sockets), and iOS doesn't expose a shell where a CLI would make sense.
