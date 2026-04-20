# Captures

This directory holds raw wire-traffic captures used to document the protocol
that `docs/PROTOCOL.md` specifies. See `docs/REVERSE_ENGINEERING.md` for the
capture methodology.

## Layout

Each capture session gets its own subdirectory, named
`<YYYY-MM-DD>-<short-description>/`. A session corresponds to exactly one
logical operation (one autofill, one status query, one save, etc.).

Inside a session directory:

- `notes.md` — what user action was performed, what versions of macOS,
  Strongbox, and the browser extension were in use, anything noteworthy
  about the environment, and hypotheses / questions raised by this capture.
- `in.hex`, `out.hex` — raw bytes between the browser and afproxy
  (`xxd`-formatted so diffs are readable), captured by the shim described
  in `docs/REVERSE_ENGINEERING.md` Layer A. A session with multiple
  sub-operations may instead contain numbered sub-directories each with
  their own `in.hex` / `out.hex` / `meta.txt`.
- `meta.txt` — pid, argv, timestamp, and the real-afproxy path recorded
  by the shim for that invocation.
- `socket.hex` — optional; raw `AF_UNIX` bytes between afproxy and
  Strongbox.app (Layer B).
- `plaintext.jsonl` — optional; decrypted payloads obtained via the
  MitM encryption bridge described in Layer D (one JSON record per line,
  per direction, per RPC).

## What must not be committed

- Real credentials from your own vault. Use a throwaway vault with
  synthetic entries.
- Paths that contain your home directory name. Rewrite them to `~`.
- Anything from reading the Strongbox or browser-autofill source tree.
  This directory holds **observed** data, not derived summaries of
  published source. See `CONTRIBUTING.md`.

Local-only captures that you don't want to publish can live in
`docs/captures/local/`; that path is gitignored.
