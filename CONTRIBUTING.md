# Contributing

Thanks for your interest. Before you file a PR, please read the licensing discipline below — it is the most important thing about this project.

## Clean-room discipline

This project is MIT-licensed. It speaks to a system (Strongbox) whose source code is published under the AGPL-3.0. Those two licences are incompatible for code derivation: AGPL code, or code translated/transliterated from AGPL sources, cannot be shipped from an MIT project.

To keep the licensing story clean, this project follows a **"clean-room" / "Chinese wall"** approach:

1. **Protocol specifications are public artefacts.** What goes on the wire between `afproxy` and `Strongbox.app` can be observed by anyone with a packet capture / `socat` / `dtruss` / Frida / a USB cable and some patience. Describing that observed behaviour in English, in a separate document, is a spec, not a derivative work.
2. **The implementation of that spec must be written from the spec, not from Strongbox's source.** If a contributor has recently read the Strongbox or `browser-autofill` source, that contributor should either (a) document protocol findings only (no code) or (b) let some time pass before writing implementation code covering the same subsystem.
3. **Don't paste, don't translate, don't transliterate.** This includes translating Objective-C or TypeScript to TypeScript line-by-line with the logic preserved. The point of a clean-room implementation is that the output is *independent*, not that it's obfuscated.
4. **Cite public sources, not AGPL sources.** `docs/PROTOCOL.md` cites Strongbox's public KB article, Chrome's Native Messaging docs, libsodium documentation, etc. It does not cite specific files or line numbers in `strongbox-password-safe/*`.
5. **When in doubt, discuss first.** Open an issue tagged `protocol-question` before sending code.

PRs that appear to derive from AGPL sources will be rejected, regardless of how much work went into them. This is not personal — it's the only way this project can ship under MIT.

## Branch model

- `main` is the stable branch.
- Protocol-discovery work happens on `research/*` branches.
- Implementation happens on `feat/*` branches.

## Commit messages

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`). Keep the subject line under 72 characters.

## Code style

- TypeScript `strict: true`.
- `prettier` for formatting, `eslint` for linting.
- No `any`. Where the protocol schema is genuinely unknown, use `unknown` and narrow with a type guard.
- Errors are thrown as typed `StrongboxError` subclasses (see `src/util/errors.ts`).

## Testing

- Unit tests for anything that doesn't touch a real Strongbox. Use Bun's built-in test runner: `bun test`.
- Integration tests live under `tests/integration/` and are skipped by default; they require a running Strongbox Pro install and will only run if `STRONGBOX_CLI_INTEGRATION=1` is set in the environment.
- Please do not commit dumps of your own vault into tests. Use `tests/fixtures/` with synthetic data.

## Security reports

If you find something that looks like a security issue — in this CLI itself, not in Strongbox — please email the maintainer listed in `package.json` rather than opening a public issue.

If you find something that looks like a security issue in Strongbox itself, report it to Strongbox (support@strongboxsafe.com), not here.
