# Reverse-engineering methodology

This document describes how to gather the protocol information that `docs/PROTOCOL.md` needs, **without** reading the Strongbox or `browser-autofill` source code.

## Ground rules

1. **Observe, don't decompile.** You are allowed (and encouraged) to watch wire traffic. You are not — for purposes of contributing to this project — reading the Strongbox source tree.
2. **Record what you observe in English, in `docs/PROTOCOL.md`.** Each new observation is a commit against that document. Implementation code follows separately.
3. **Capture raw bytes, not decoded structures.** Hex-dumps and PCAPs are fine. Prose summaries of "what the function does" read from source are not.
4. **When you finish a session, note what you did, so future contributors know the chain of custody.** A one-paragraph note in the commit message is enough.

## Observation layers

There are four places to sit and watch:

### Layer A — stdio between the browser and afproxy

This is the easiest capture point. The browser's Native Messaging host manifest points at `afproxy`. We replace that with a shim that `tee`s stdin and stdout through to the real binary and logs everything.

1. Find the manifest:
   ```sh
   ls -l ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/
   ls -l ~/Library/Application\ Support/Mozilla/NativeMessagingHosts/
   ```
   The Strongbox manifest will have `"allowed_origins": ["chrome-extension://mnilpkfepdibngheginihjpknnopchbn/"]`.
2. Note the current `path` value. That's where `afproxy` lives.
3. Write a shim script (e.g. in `tools/sniff-native-host.sh`) that:
   - opens two log files (`in.bin`, `out.bin`);
   - uses `tee` / shell redirection to copy stdin to `in.bin` while piping it to the real `afproxy`;
   - copies the real `afproxy`'s stdout to `out.bin` while writing it back to the browser.
   (A ~15-line bash script or a slightly longer Python/Bun script both work.)
4. Edit the manifest to point `path` at your shim. Restart the browser.
5. Interact with the extension: open a login page, click the Strongbox icon, unlock, pick an entry, let it autofill, save a new credential, log out, etc. Do this once per distinct operation you want to observe. Reset `in.bin`/`out.bin` between operations so each capture corresponds to exactly one RPC family.
6. Commit hex dumps of the captures under `docs/captures/` with a README explaining what the user actions were. Redact anything from your own vault.
7. Restore the manifest to its original `path`.

### Layer B — the AF_UNIX socket between afproxy and Strongbox.app

Same idea, one layer deeper. Replace the socket with a passthrough.

1. First, confirm the socket path. Options, in order of least to most invasive:
   - `ls ~/Library/Group\ Containers/group.strongbox.mac.mcguill/` (look for `.sock` files).
   - `lsof -U -p $(pgrep -x Strongbox)` (requires that Strongbox is running and that `lsof` can see into the sandboxed group container — often it can).
   - `sudo fs_usage -w -f filesys Strongbox` while the extension connects.
2. Stop Strongbox. Rename the real socket out of the way.
3. Run `socat -v UNIX-LISTEN:<real path>,fork UNIX-CONNECT:<real path>.backup` so that everything written to the "real" path is forked to the log and forwarded to the backup. (`socat -x` for hex output.)
4. Start Strongbox again. Because the socket was already created by `socat`, Strongbox may or may not cooperate — depending on who's expected to `bind()` vs. `connect()`. If it fails, swap the direction: you may need to let Strongbox bind as usual and instead intercept the client side by replacing `afproxy`'s socket path via DYLD tricks or by using the shim from Layer A to dump both stdio and the socket.
5. As with Layer A, commit hex dumps, not prose summaries of decoded fields.

### Layer C — `dtruss` / `dtrace` on afproxy or Strongbox

Useful for finding *where* afproxy opens sockets and *what* file paths it reads at startup — not for reading decrypted payload content (the crypto happens in-process, not in a syscall).

```sh
sudo dtruss -f -t read,write,connect,bind,open -p $(pgrep afproxy)
```

Use this mainly to verify paths (Layer B step 1) and argv/envp on startup, rather than to understand application logic.

### Layer D — plaintext recovery

Two strategies recover the inner plaintext under the `crypto_box` envelope. Both stay clean-room: neither reads Strongbox source. We used the first one (MitM) successfully on 2026-04-20; the second (Frida) remains as a documented alternative.

#### Layer D.1 — MitM (used, preferred)

Sit a back-to-back encryption proxy between the browser and the real `afproxy`. The proxy generates its own two keypairs, impersonates the server to the browser, impersonates the browser to the server, and decrypts/re-encrypts each envelope at the hinge. Every plaintext that would have been in memory only now lands in our log.

```
browser ─[crypto_box to serverFacePK]─▶ mitm ─[crypto_box to realServerPK]─▶ afproxy ─▶ Strongbox.app
        ◀─[crypto_box to browserPK ]──      ◀─[crypto_box to clientFacePK]──
```

Why MitM over Frida: it observes only our own wire traffic. No process attachment, no `DYLD_*`, no memory inspection. The epistemic footing is the same as watching an HTTPS proxy whose root cert you installed yourself.

Implementation: `tools/mitm-afproxy.sh` (wrapper Chrome launches) and `tools/mitm-afproxy.ts` (the crypto bridge). The bridge persists its impersonating keypairs under `~/Library/Application Support/strongbox-cli-mitm/` and writes one capture dir per Chrome↔host invocation to `${STRONGBOX_CLI_MITM_DIR:-~/strongbox-mitm}/<timestamp>-<pid>/` containing `in.bin`, `out.bin`, `plaintext.jsonl`, and `meta.txt`.

Install procedure we used on 2026-04-20:

1. **Fresh Chrome profile**: `open -na 'Google Chrome' --args --user-data-dir=/tmp/chrome-mitm`. This matters because an existing profile's extension may have pinned the real server's public key from a prior session, causing decryption failures once the MitM substitutes its own key.
2. Install the Strongbox AutoFill extension fresh in that profile.
3. Drop the Native Messaging host manifest at **`/tmp/chrome-mitm/NativeMessagingHosts/com.markmcguill.strongbox.json`**. When Chrome on macOS is launched with `--user-data-dir`, it reads host manifests from `<user-data-dir>/NativeMessagingHosts/` — **not** from the usual `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`. Missing this will make Chrome report `"Specified native messaging host not found."` even though the system-path copy exists.
4. Manifest's `"path"` points at `tools/mitm-afproxy.sh`.
5. Hardcode `BUN_PATH` in `mitm-afproxy.sh` to the absolute path of your `bun` binary. Chrome launches native hosts under launchd's minimal `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), so `command -v bun` returns empty there.
6. Export `STRONGBOX_CLI_MITM_REAL=/Applications/Strongbox.app/Contents/MacOS/afproxy` so the bridge knows where to forward.
7. Drive the extension normally. Each UI action produces one or more capture dirs.
8. First-run note: we expected Strongbox to pop a TOFU approval dialog the first time our client-face key was presented. It didn't. Working hypothesis: because the fresh-profile extension had never registered a key, the first key Strongbox saw was ours, not a replacement for a pinned one.
9. When done, remove the manifest or restore the real `afproxy` path.

The bridge handles `messageType=0` specially (no client-side crypto — see PROTOCOL.md §4.2). The real server's public key is learned from the Hello response and persisted, so subsequent encrypted requests can be forwarded.

Sample captures produced this way are committed under `docs/captures/2026-04-20-layerD/`.

#### Layer D.2 — Frida hook (alternative, unused)

Hook libsodium in the live Strongbox process and log the arguments to `crypto_box_easy` / `crypto_box_open_easy` on every call. Works if you can't set up a MitM for some reason (e.g. you're trying to see plaintext the *client* side produces and it lives behind a process boundary you can't intercept).

1. `brew install frida` / `pip install frida-tools`.
2. Identify which libsodium the app links against. Either a bundled `libsodium.dylib` in `Strongbox.app/Contents/Frameworks/` or a static link. If static, symbol names are still exported unless stripped.
3. Strongbox ships hardened-runtime with no `get-task-allow` entitlement, so Frida can't attach out of the box. The Mac App Store binary can be ad-hoc re-signed locally to change that; full source is not required. Do this on a copy of the app, not the App Store install.
4. Attach Frida and hook `crypto_box_easy` / `crypto_box_open_easy`. Log plaintext + both public keys + nonce on every call.
5. Commit redacted plaintexts to `docs/captures/` alongside the ciphertexts so the mapping can be verified.

This is more invasive than MitM — it reads the target process's memory — but it's still observation, not source derivation, and it's the fallback if ever the MitM strategy breaks (e.g. Strongbox adds transcript binding that pins the real server key outside the envelope).

## What to commit

For each observation session, commit under `docs/captures/<YYYY-MM-DD>-<operation>/`:

- `README.md` or `notes.md` — what user actions you took, what OS version, what Strongbox version, what browser + extension version; observations; hypotheses about structure; open questions.
- `in.hex`, `out.hex` — raw framed bytes as seen by the shim (Layer A and Layer D.1 both emit these).
- `socket.hex` (if Layer B) — raw AF_UNIX traffic.
- `plaintext.jsonl` (if Layer D) — the decrypted bodies, one JSON record per direction per RPC.
- `meta.txt` (if Layer D.1) — per-invocation diagnostics (argv, ppid, cwd, keypair fingerprints).

Once enough sessions accumulate, promote the stable bits into `docs/PROTOCOL.md` as a formal spec with a version number, and cite the capture directories by path.

## What *not* to commit

- Your real vault contents. Use a throwaway vault with synthetic entries.
- Your real private keys. The ephemeral keys generated during capture are fine to commit because they're single-session.
- Paths that hardcode your username.

## When to stop

The protocol is "documented enough to implement" when:

- Handshake: sequence, message types, key persistence rules all written down.
- At least these RPCs have known request + response shapes: status, list databases, get credentials for URL, get TOTP.
- Error responses have known shapes.
- Framing (length prefix, nonce placement, ordering) is nailed down on both the stdio side and the socket side.

Until then, `src/protocol/messages.ts` should carry `unknown` types guarded by schema validation, and everything above the transport layer should be behind a `--protocol=v0-experimental` flag.
