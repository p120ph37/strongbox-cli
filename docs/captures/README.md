# Captures

This directory holds raw wire-traffic captures used to document the protocol
that `docs/PROTOCOL.md` specifies. Each session's `notes.md` records how it was
captured.

## Observation layers

The notes refer to observation points along the browser → afproxy → Strongbox
chain:

- **Layer A** — stdio between the browser and `afproxy` (a native-messaging
  shim records the framed JSON; ciphertext, not yet decrypted).
- **Layer B** — the `AF_UNIX` socket between `afproxy` and `Strongbox.app`.
- **Layer C** — syscall tracing (`dtruss`/`dtrace`) of `afproxy` or Strongbox.
- **Layer D** — plaintext recovery. **D.1** is a back-to-back-encryption MitM
  native host (decrypts and re-encrypts each envelope); **D.2** would be a
  Frida hook on `crypto_box_*`. All committed plaintext came from D.1.

## Layout

Each capture session gets its own subdirectory, named
`<YYYY-MM-DD>-<short-description>/`. A session corresponds to exactly one
logical operation (one autofill, one status query, one save, etc.).

Inside a session directory:

- `notes.md` — what user action was performed, what versions of macOS,
  Strongbox, and the browser extension were in use, anything noteworthy
  about the environment, and hypotheses / questions raised by this capture.
- `in.hex`, `out.hex` — raw bytes between the browser and afproxy
  (`xxd`-formatted so diffs are readable), captured by a native-messaging
  shim. A session with multiple sub-operations may instead contain numbered
  sub-directories each with their own `in.hex` / `out.hex` / `meta.txt`.
- `meta.txt` — pid, argv, timestamp, and the real-afproxy path recorded
  by the shim for that invocation.
- `plaintext.jsonl` — optional; decrypted payloads obtained via a
  back-to-back-encryption MitM bridge (one JSON record per line, per
  direction, per RPC). See the session's `notes.md` for the exact setup.

## What must not be committed

- Real credentials from your own vault. Use a throwaway vault with
  synthetic entries.
- Paths that contain your home directory name. Rewrite them to `~`.
- Anything from reading the Strongbox or browser-autofill source tree.
  This directory holds **observed** data, not derived summaries of
  published source. See `CONTRIBUTING.md`.

Local-only captures that you don't want to publish can live in
`docs/captures/local/`; that path is gitignored.
