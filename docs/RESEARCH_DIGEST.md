# Research digest

Condensed notes from the public-source research that seeded this project. Keep this in-tree so future contributors don't have to redo the search.

## Strongbox itself

- **Official site:** <https://strongboxsafe.com/>
- **Main repo (Objective-C / Swift, AGPL, source-available but not buildable):** <https://github.com/strongbox-password-safe/Strongbox>
- **Browser extension repo (TypeScript, AGPL):** <https://github.com/strongbox-password-safe/browser-autofill>
- **Developer:** Mark McGuill (<https://github.com/strongbox-mark>)
- **macOS bundle identifier prefix:** `com.markmcguill.strongbox`
- **Group container (contains shared state between app and helpers):** `~/Library/Group Containers/group.strongbox.mac.mcguill/`
- **Chrome extension ID:** `mnilpkfepdibngheginihjpknnopchbn`
- **Firefox add-on ID:** published at <https://addons.mozilla.org/firefox/addon/strongbox-autofill/>; TBD the exact ID from the add-on manifest.

The Strongbox app repo publishes its main app code but **omits the build config and some secrets** (Google Drive / Dropbox / OneDrive developer keys), and the upstream policy is explicitly "open source, not open contribution": <https://github.com/strongbox-password-safe/Strongbox/blob/master/README.md>. PRs are not accepted.

## No official CLI or API

A feature request for a CLI / scripting API (comparing to Bitwarden and KeePassXC) was filed in March 2024 and has had **zero maintainer response** in over two years: <https://github.com/strongbox-password-safe/Strongbox/issues/768>. No branches, no PRs. It is reasonable to assume one is not imminent.

There is no published third-party scripting client for Strongbox. (Confusingly, there are two other projects on GitHub called "Strongbox" — `jasonhilder/strongbox`, a Go password manager, and `schibsted/strongbox`, an archived AWS secrets wrapper. Neither is related to this Strongbox.)

## Topology of the browser integration

From Strongbox's own KB article on how the extension works (<https://strongbox.reamaze.com/kb/security-and-privacy/how-does-the-chrome-slash-firefox-extension-work-is-it-secure>):

- The browser uses Chrome / Firefox **Native Messaging** to talk to a helper binary called **`afproxy`**.
- `afproxy` exists because browsers spawn a new native-host process per message, so the long-lived connection has to be held on the app side.
- `afproxy` relays to the main Strongbox app via a **Unix domain socket** inside the group container.
- Payloads across this chain are encrypted with a **Crypto Box** — libsodium's authenticated asymmetric encryption — using **ephemeral public/private keypairs**.
- All of this is local-only; no TCP, no open ports.

Source directories inside `Strongbox/macbox/` that correspond to this pipeline (confirmed to exist by directory listing — we have not read their contents for implementation purposes):

- `afproxy/` — the native-messaging helper.
- `autofill-proxy/` — the app side of the Unix-socket IPC.
- `browser-autofill/` — integration glue.
- `ssh-agent/` — the unrelated ssh-agent socket listener.

## The SSH-agent interface (useful but orthogonal)

From <https://strongbox.reamaze.com/kb/ssh-agent/ssh-agent>, Strongbox exposes a standard OpenSSH agent socket at:

```
~/Library/Group Containers/group.strongbox.mac.mcguill/agent.sock
```

This speaks the plain OpenSSH agent wire protocol — any `ssh-add`, `ssh`, `git` etc. can use it by setting `IdentityAgent` in `~/.ssh/config`. It is not the same channel as the autofill IPC and will not give you password lookup. It is, however, the easiest possible "scripting" integration with Strongbox for SSH-key use cases.

## Chrome / Firefox Native Messaging basics

- Chrome docs: <https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging>
- Firefox docs: <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging>

Key facts we depend on:

- Messages are JSON, UTF-8, preceded by a `uint32` length prefix in **native byte order** (little-endian on all Macs Strongbox supports).
- Max 1 MB from extension to host; max 4 GB from host to extension.
- Host manifests live in per-browser directories; on macOS:
  - Chrome: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
  - Chromium: `~/Library/Application Support/Chromium/NativeMessagingHosts/`
  - Firefox: `~/Library/Application Support/Mozilla/NativeMessagingHosts/`
- On macOS/Linux, Chrome launches the host with one argv: the extension origin. Firefox launches with two: the manifest path and the extension ID.

## libsodium Crypto Box

- Docs: <https://doc.libsodium.org/public-key_cryptography/authenticated_encryption>
- Construction: Curve25519 key agreement → XSalsa20 stream cipher → Poly1305 MAC.
- Key size 32 bytes, nonce 24 bytes, MAC overhead 16 bytes.
- Node/Bun: the `libsodium-wrappers-sumo` package is what we'll use.

## What we still need to learn empirically

Everything actually sitting on the wire — handshake shape, RPC vocabulary, framing inside the crypto envelope, the exact socket filename. See `docs/REVERSE_ENGINEERING.md` for how to find out.

## Related reading

- KeePassXC has a similar architecture for its browser extension (KeePassXC-Browser), which is also well-documented and open source. Studying *that* protocol is useful background because it solves the same problem and has published its design openly. Reading KeePassXC source is fine under our clean-room discipline; reading Strongbox source is not. <https://github.com/keepassxreboot/keepassxc-browser>
- The original KeePass 2 file format spec: <https://keepass.info/help/kb/kdbx.html>
