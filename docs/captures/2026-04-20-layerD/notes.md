# Layer-D (plaintext) captures — 2026-04-20

First plaintext recovery of the inner RPC layer. One invocation per
observed `messageType`, covering every operation the browser extension
UI can drive. All captures are from a throwaway test vault; no real
credentials are included, and user-chosen database nicknames have been
rewritten to synthetic placeholders (`vault-a`).

## How these were captured

We did **not** read Strongbox source, hook it with Frida, or lift
plaintext from an in-memory debugger. The captures come from a
back-to-back encryption MitM native-messaging host that sits in place
of Strongbox's real `afproxy`:

```
browser ─┬─[crypto_box(browserPK, serverFacePK)]──▶ mitm-afproxy ─┬─[crypto_box(clientFacePK, realServerPK)]──▶ afproxy ──▶ Strongbox.app
         │                                                       │
         └─◀─[crypto_box(serverFacePK, browserPK)]────────────────┘
```

The MitM:

1. Keeps two long-lived keypairs in
   `~/Library/Application Support/strongbox-cli-mitm/` — one *server-face*
   pair shown to the browser, one *client-face* pair shown to Strongbox.
2. Decrypts each envelope's `message` field with the appropriate keypair,
   records plaintext to `plaintext.jsonl`, then re-encrypts with the
   opposite keypair under a fresh nonce before forwarding.
3. Handles `messageType=0` specially: no crypto on the request side, so
   we only substitute the `clientPublicKey` field. The response gives us
   the real server's public key, which we persist at
   `real-server-pubkey.txt` for subsequent encrypted requests.

Source: `tools/mitm-afproxy.ts` (the Bun script that implements the
crypto bridge) and `tools/mitm-afproxy.sh` (the wrapper Chrome actually
launches).

### Install procedure we used

1. **Fresh Chrome profile.** `open -na 'Google Chrome' --args --user-data-dir=/tmp/chrome-mitm`.
   The fresh profile ensures the extension hasn't pinned any previous
   server public key that would now fail to verify.
2. **Install the Strongbox AutoFill extension** from the Chrome Web Store
   in that fresh profile.
3. **Install the native-host manifest** at
   `/tmp/chrome-mitm/NativeMessagingHosts/com.markmcguill.strongbox.json`
   (Chrome on macOS, when launched with `--user-data-dir`, reads host
   manifests from inside the data dir — **not** from
   `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`).
   The manifest's `path` points at `tools/mitm-afproxy.sh`.
4. **Hardcode `BUN_PATH`** in the wrapper. Chrome launches native hosts
   under launchd's minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), which
   does not include `~/.bun/bin`, so `command -v bun` returns empty.
5. **Point the wrapper at the real afproxy** via
   `STRONGBOX_CLI_MITM_REAL=/Applications/Strongbox.app/Contents/MacOS/afproxy`.
6. Drive the extension normally. Every Chrome↔native-host roundtrip
   produces one new dir under `${STRONGBOX_CLI_MITM_DIR:-~/strongbox-mitm}/`
   with `in.bin`, `out.bin`, `plaintext.jsonl`, and `meta.txt`.

### Why the client-face key was implicitly trusted

We expected Strongbox to pop a TOFU approval dialog the first time the
MitM's client-face key was presented. It did not. Working hypothesis:
the fresh-profile extension had not previously registered a key with
Strongbox either, so the first key Strongbox saw was our client-face
key — not a replacement for a pinned one. Strongbox treats a
never-before-seen extension origin/key combo as first-use and admits it
without a prompt.

## Clean-room discipline

This was observation of our own wire traffic only. Nothing in these
captures is derived from reading Strongbox's source, its headers, or
any of its internal debugging output. The MitM manipulates keys we
generated ourselves and ciphertext we constructed ourselves with
libsodium. See `CONTRIBUTING.md`.

## Directory contents per capture

| file              | description                                                   |
|-------------------|---------------------------------------------------------------|
| `in.hex`          | `xxd` of raw bytes the browser wrote to the host's stdin.     |
| `out.hex`         | `xxd` of raw bytes the host wrote back to the browser.        |
| `plaintext.jsonl` | Decrypted plaintext, one line per direction-decode.           |
| `meta.txt`        | Date, our keypairs, the learned real-server pubkey, argv.     |

`plaintextHex` fields and ephemeral browser pubkeys have been stripped
from the committed `plaintext.jsonl`. The PNG favicon in the
`messageType=6` create-entry request has been replaced with
`"<PNG-base64 elided>"` (≈5 KiB of base64 per entry).

## Capture index

| dir                          | messageType | operation                   |
|------------------------------|-------------|-----------------------------|
| `00-mt0-hello/`              | 0           | Hello / initial handshake   |
| `01-mt2-search-url/`         | 2           | Search credentials by URL   |
| `02-mt3-copy-field/`         | 3           | Copy-to-keyboard field fill |
| `03-mt4-unlock-db/`          | 4           | Unlock database             |
| `04-mt5-lock-db/`            | 5           | Lock database               |
| `05-mt6-create-entry/`       | 6           | Create new entry            |
| `06-mt7-list-groups/`        | 7           | List groups in database     |
| `07-mt11-generate-password/` | 11          | Generate password           |
| `08-mt12-check-strength/`    | 12          | Check password strength     |
| `09-mt13-prepare-new-entry/` | 13          | Prepare create-entry form   |

See `docs/PROTOCOL.md` §5 for the confirmed request/response schemas
derived from these captures.
