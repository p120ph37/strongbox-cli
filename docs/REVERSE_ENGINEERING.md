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

### Layer D — hook libsodium with Frida

This gets us plaintext *without* reading source. It's the right tool for figuring out the handshake.

1. `brew install frida` / `pip install frida-tools`.
2. Identify which libsodium the app links against. Either a bundled `libsodium.dylib` in `Strongbox.app/Contents/Frameworks/` or a static link. If static, symbol names are still exported unless stripped.
3. Attach Frida and hook `crypto_box_easy` and `crypto_box_open_easy`. Log the plaintext + both public keys + nonce on every call.
4. Interact with the extension. Every encrypted message on the wire now has a plaintext in your log.
5. Commit redacted plaintexts to `docs/captures/` and, crucially, the hex dumps that correspond to them so the ciphertext-to-plaintext mapping can be independently verified.

Frida is doing interpretive work Strongbox itself would normally keep to itself, but it's operating on our own machine, against our own running copy of the app, observing its behaviour as a user. That's the same epistemic footing as looking at the network with Wireshark.

## What to commit

For each observation session, commit under `docs/captures/<YYYY-MM-DD>-<operation>/`:

- `README.md` — what user actions you took, what OS version, what Strongbox version, what browser + extension version.
- `stdio-in.hex`, `stdio-out.hex` — raw framed bytes as seen by the shim.
- `socket.hex` (if Layer B) — raw AF_UNIX traffic.
- `plaintext.json` (if Layer D) — the decrypted bodies.
- `notes.md` — any observations; hypotheses about structure; open questions.

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
