# Roadmap

Milestones are ordered by "what unblocks what", not by calendar time.

## M0 — Bootstrap (this commit)

- [x] Project skeleton, TypeScript, Bun, MIT license.
- [x] Clean-room contribution rules.
- [x] Protocol doc with clear "known" vs. "TBD" split.
- [x] Reverse-engineering methodology doc.
- [x] CLI stub with `--help` and `--version`.

## M1 — Discovery

- [x] Locate the Strongbox Native Messaging manifest on disk. Implement `src/transport/manifest.ts` (pure file-system lookup, no afproxy invocation).
- [x] `strongbox-cli diagnose` command: prints manifest path, manifest contents, afproxy path, existence of the group container, permissions, etc. Useful both for us during development and for users debugging later.
- [x] Commit first Layer-A captures under `docs/captures/` covering at minimum: extension startup, one `get-credentials-for-url`, and a successful autofill.

## M2 — Transport

- [x] Native Messaging framing codec (`src/transport/native-messaging.ts`): uint32-LE length prefix over UTF-8 JSON. Unit tested with fixtures in `tests/fixtures/native-messaging/`.
- [x] Process manager (`src/transport/afproxy.ts`): spawn afproxy with correct argv, pipe stdio, surface errors, clean shutdown on SIGINT / process exit.
- [x] End-to-end plaintext ping test: can we get _any_ response from a real afproxy with no crypto layer yet? (Probably not, since it'll expect a handshake — but confirming the failure mode is itself a data point.)

## M3 — Crypto

- [x] `src/crypto/box.ts`: thin wrapper over `libsodium-wrappers-sumo` with the specific `crypto_box_easy` / `crypto_box_open_easy` signatures we need. Typed. Nonce generation strategy pluggable (random / counter), defaulted per the observed protocol.
- [x] Keypair persistence (`src/crypto/identity.ts`): store our client keypair at `~/Library/Application Support/strongbox-cli/identity.json` with 0600 perms. Rotate on request.
- [x] Handshake implementation matching whatever captures in M1 showed.

## M4 — First RPC

- [x] `strongbox-cli status`: opens a session, completes the handshake, sends the status RPC, prints result. This is the "one end-to-end path works" milestone.
- [x] Integration test harness: `STRONGBOX_CLI_INTEGRATION=1 bun test tests/integration/` runs against a real Strongbox; otherwise skipped.

## M5 — Read commands

- [x] `strongbox-cli list`
- [x] `strongbox-cli search <query>`
- [x] `strongbox-cli get <ref> [--field=password|username|totp|totp-uri|totp-secret|url|notes|<custom>]`
      — `totp-uri`/`totp-secret` export the raw otpauth URI / Base32 seed that the
      Strongbox UI hides (e.g. for `oathtool -b`).
- [x] `strongbox-cli url <url>` — the extension's main call.
- [x] `strongbox-cli totp <ref>`
- [x] `strongbox-cli copy <ref> [--field=username|password|totp]` — mt=3
      CopyField; Strongbox writes the value to the OS clipboard (autotype for
      non-browser targets). Nothing secret is printed to stdout.

Output rules: one value per invocation by default (scriptable); `--json` for structured output; never print secrets unless explicitly asked for a secret field.

## M6 — Write commands (conditional)

- [x] `strongbox-cli add` — mt=6 CreateEntry. Creates title/username/password/url
      in a chosen database + group (`--group`, default root); password via
      `--password`, `--password-stdin`, or `--generate`. **Limited by the protocol**:
      mt=6 carries only those four fields, so notes/totp/tags/custom-fields cannot be
      set at creation.
- [ ] ~~`strongbox-cli edit`~~ — **not possible over this protocol.** The full
      dispatch surface (mt=0–15) has no update or delete op; mt=6 has no entry-id
      field and always creates a new UUID. The extension only ever creates (saving a
      new login); editing/deleting is a Strongbox-app operation. Nothing to build
      here unless a future Strongbox adds an update messageType.

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
