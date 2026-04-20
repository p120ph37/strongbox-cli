# 2026-04-17 envelope capture set

Six captures selected from a 94-session Layer-A run (the full set lived at
`~/strongbox-sniff/` on the capture machine and is not committed). Each
sub-directory contains:

- `in.hex`   — `xxd` of the raw bytes sent by Chrome to the shim.
- `out.hex`  — `xxd` of the raw bytes returned by `afproxy` through the shim.
- `meta.txt` — pid, argv, and wall-clock timestamp as recorded by the shim.

Both byte streams are framed as **uint32-LE length prefix + UTF-8 JSON**,
the standard Chrome Native Messaging framing. Inside the JSON, `message`
is a `crypto_box_easy` ciphertext (base64) whenever `messageType ≠ 0`.

The ciphertext cannot be decrypted from these captures alone — the server's
private key is held by Strongbox and the client's private key was held by
the browser extension's in-memory context at the time of capture. Layer D
(Frida on `crypto_box_easy` / `crypto_box_open_easy`) is required to
recover plaintext; see `docs/REVERSE_ENGINEERING.md`.

## Capture environment

- Date: 2026-04-17 (UTC).
- Platform: macOS (darwin 25.1.0, arm64).
- Browser: Google Chrome, user profile.
- Extension: Strongbox Chrome extension, origin
  `chrome-extension://mnilpkfepdibngheginihjpknnopchbn/`.
- Host: Strongbox Pro app running, vault unlocked.
- Vault: **throwaway synthetic vault** — no real credentials present.
  Ciphertext in these captures is therefore safe to publish.

## Selection rationale

The raw run produced 94 directories, most of which were either the Hello
ping (`mt=0`, 48 samples) or a short read RPC (`mt=2`, 39 samples). The
six chosen here cover each observed envelope shape once:

| sub-dir                         | messageType | user action that triggered it                            |
| ------------------------------- | ----------- | -------------------------------------------------------- |
| `01-hello/`                     | 0           | Any popup / icon click; this is the plaintext-request Hello ping |
| `02-mt2-no-match/`              | 2           | Extension probing a tab whose URL had no matching entry  |
| `03-mt2-credential-list/`       | 2           | Extension probing a tab whose URL *did* match; big rsp   |
| `04-mt11-empty-request/`        | 11          | Opening the extension's full-tab view (2-byte request, ~1 KB response — likely "list databases") |
| `05-mt6-create-entry/`          | 6           | Submitting the extension's "Create" form with a generated password |
| `06-mt2-list-after-create/`     | 2           | Next list probe after the create — response grew by ≈3.6 KB, consistent with the new entry being included |

Size-class evidence for the Create label: the `mt=6` request is 3765
plaintext bytes (~one full entry record) and the response is 3688 bytes
(plausibly the saved entry echoed back). Credential-list responses in
subsequent `mt=2` captures jumped from ~6229 bytes plaintext to ~9857 —
the delta is close to one entry's worth of data.

## What this set proves

- The outer envelope shape (§4.1 of `docs/PROTOCOL.md`) is correct across
  every observed `messageType`.
- The Native Messaging framing (uint32-LE length prefix + UTF-8 JSON,
  §2 of `docs/PROTOCOL.md`) is used in both directions.
- The server's public key (`ET3PwCLE…BFCE=`, visible in every `out.hex`
  here) is stable across sessions — consistent with a persistent
  server-side keypair.
- Every invocation is a one-shot: Chrome spawns a fresh host process per
  message, and the process exits after the single response. There is no
  multi-message handshake on a single connection.

## What this set does *not* prove

- The inner plaintext schema (field names inside the decrypted `message`).
- The semantic label attached to `mt=2/3/4/5/6/7/11/13`. The labels in
  the table above are correlation-based guesses, not observations.
- The nonce-generation strategy (random vs. counter). The four
  `mt ≥ 2` captures here each carry a distinct-looking nonce; a larger
  sample would be needed to rule out a counter with a randomised prefix.
- Request/response correlation mechanics. Because each round-trip is a
  separate OS process, there may not be any `id` field inside the
  ciphertext at all.

Answers to all of those come from Layer-D (Frida) captures.
