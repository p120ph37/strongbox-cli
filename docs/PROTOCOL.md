# Protocol notes

This document describes the communication path between the Strongbox browser extension and the Strongbox macOS application, insofar as it can be inferred from Strongbox's public documentation, Chrome/Firefox's Native Messaging specification, macOS conventions, and the libsodium "Crypto Box" construction.

Everything here is derived from **public sources**. Nothing in this document should be derived from reading the AGPL-licensed Strongbox source tree. Where the actual on-wire shapes are unknown, this document says "TBD (observe)" rather than speculating from source.

---

## 1. Topology

```
┌────────────────────┐  stdio (length-prefixed JSON)   ┌────────────┐   AF_UNIX (SOCK_STREAM)   ┌──────────────────┐
│ Browser extension  │ ──────────────────────────────▶ │  afproxy   │ ────────────────────────▶ │  Strongbox.app   │
│ (Chrome / Firefox) │                                 │ (spawned)  │                           │ (user session)   │
└────────────────────┘                                 └────────────┘                           └──────────────────┘
```

This topology is described verbatim in the Strongbox KB article
"How Does the Chrome/Firefox Extension Work? Is It Secure?":

> For technical reasons (browsers launch a new process for each message) this goes
> through a small proxy helper app called "afproxy". Afproxy then communicates with
> Strongbox using a Unix Local Domain socket for IPC. So, again local/on-device
> interprocess communication. No TCP/IP or networking sockets/open ports. To avoid
> casual snooping we also encrypt all traffic end to end using asymmetric encryption
> (e.g. public/private key pair, ephemeral) with a technique called a "Crypto Box"
> or a "Secret Key Box".

Source: <https://strongbox.reamaze.com/kb/security-and-privacy/how-does-the-chrome-slash-firefox-extension-work-is-it-secure>

Two important consequences follow from the quote above:

1. The **transport** is stdio on the browser side and `AF_UNIX` on the app side.
   `afproxy` is a trivial relay that exists because Chrome spawns a fresh native
   host process per message and so cannot hold a long-lived socket itself.
2. The **payloads** are encrypted end-to-end with an asymmetric Crypto Box. The
   extension's keypair and the app's keypair are both ephemeral — i.e., generated
   per session, not long-lived. This means there must be a **handshake** that
   exchanges public keys before any real RPC can happen, because neither side
   knows the other's key at startup.

## 2. Transport layer 1 — Native Messaging (extension ⇄ afproxy)

The stdio side follows Chrome's / Firefox's standard Native Messaging framing
(same wire format for both browsers):

- **Each message is a JSON document encoded as UTF-8.**
- **Each message is prefixed with a little-endian `uint32` giving the byte length
  of the JSON that follows.** (The spec says "native byte order"; on every
  platform Strongbox runs on — x86_64 and arm64 Macs — that's little-endian.)
- Maximum message size is 1 MB extension→host, 4 GB host→extension.

References:
- <https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging>
- <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging>

### Native Messaging manifest

For the browser to launch `afproxy`, Strongbox drops a **host manifest** in a
well-known location. On macOS:

- Chrome/Chromium (user-level):
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/<name>.json`
- Firefox (user-level):
  `~/Library/Application Support/Mozilla/NativeMessagingHosts/<name>.json`

The manifest has the shape:

```json
{
  "name": "<reverse-dns-ish name>",
  "description": "...",
  "path": "/absolute/path/to/afproxy",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://mnilpkfepdibngheginihjpknnopchbn/"]
}
```

(Firefox uses `allowed_extensions` with add-on IDs instead of `allowed_origins`.)

**TBD (observe)**: the exact string used for the `name` field. The extension's
known Chrome Web Store ID is `mnilpkfepdibngheginihjpknnopchbn`.

The `path` will point somewhere inside the Strongbox app bundle, probably
`/Applications/Strongbox.app/Contents/…/afproxy`. We discover this at runtime by
reading the manifest.

### Launch arguments

Per Chrome's spec, when Chrome launches the native host on macOS/Linux it passes
one argv: the extension origin (e.g. `chrome-extension://mnilpkfepdibngheginihjpknnopchbn/`).
Firefox passes two: the path to the manifest file, and the extension ID.

Our CLI will have to decide which browser's conventions to mimic. We'll mimic
Chrome (simpler, single arg). afproxy may or may not validate this; **TBD (observe)**.

## 3. Transport layer 2 — Unix domain socket (afproxy ⇄ Strongbox.app)

The known socket path for the Strongbox SSH agent is:

```
~/Library/Group Containers/group.strongbox.mac.mcguill/agent.sock
```

(Source: <https://strongbox.reamaze.com/kb/ssh-agent/ssh-agent>.)

That is a separate socket — it speaks the OpenSSH agent wire protocol, not this
RPC protocol. The autofill socket lives in the same group container but under a
different filename. **TBD (observe)**: exact filename. Candidates to check:

- `autofill.sock`
- `afproxy.sock`
- `browser.sock`
- something containing a bundle identifier

The socket is `AF_UNIX`, `SOCK_STREAM`. The framing on this side is independent
of the stdio framing: afproxy has to re-frame whatever it reads from stdin.
**TBD (observe)** whether the inner framing is the same 4-byte little-endian
length prefix (simplest implementation) or something else.

## 4. Cryptographic envelope — Crypto Box

Per Strongbox's KB article, payloads are wrapped in a libsodium "Crypto Box":
authenticated asymmetric encryption, equivalent to `crypto_box_easy` in
libsodium, which is Curve25519 key agreement + XSalsa20 stream cipher +
Poly1305 MAC.

Parameters of a `crypto_box_easy` message:

- sender's secret key (32 bytes, Curve25519)
- recipient's public key (32 bytes, Curve25519)
- nonce (24 bytes, must be unique per (sender, recipient) pair)
- plaintext (arbitrary length)

Output: ciphertext, `plaintext_length + 16` bytes (the 16 is the Poly1305 tag).

The sender and recipient each need the other's public key before they can talk.
Hence: **handshake first, RPCs after.**

Reference: <https://doc.libsodium.org/public-key_cryptography/authenticated_encryption>

### 4.1 Handshake — TBD (observe)

The known ingredients are:

- Both sides hold an ephemeral Curve25519 keypair generated fresh per session.
- Both sides must end up knowing the other's public key.
- There is probably some one-time authorisation step where the user sees a
  prompt in Strongbox the first time a given browser extension connects, so
  that the app has some notion of "trusted client public keys" persisted across
  sessions. (This matches the UX: installing the extension and connecting for
  the first time pops a Strongbox dialog.)

**Possible handshake shapes to verify empirically:**

1. *Simple ephemeral:* extension sends `{type:"hello", pubkey:<32 bytes b64>}`
   in plaintext; app responds `{type:"hello", pubkey:<32 bytes b64>}` in
   plaintext; both sides encrypt from message 2 onward.
2. *TOFU with persisted client identity:* extension has a persisted keypair,
   sends pubkey once, user accepts in the app UI the first time, app persists
   the client pubkey, subsequent sessions skip the UI.
3. *Per-session ephemeral over persisted channel:* persisted keypair used only
   to bootstrap a fresh per-session ephemeral keypair.

Design (2) is the most plausible given the observed UX. We'll find out which
one it is by watching the wire. See `docs/REVERSE_ENGINEERING.md`.

### 4.2 Message framing after handshake — TBD (observe)

Each request/response is presumably:

```
┌──────────────────────┬─────────────┬────────────────────────────────────┐
│ nonce (24 bytes)     │ length (4)  │ crypto_box ciphertext (length B)   │
└──────────────────────┴─────────────┴────────────────────────────────────┘
```

— but that ordering, the nonce generation strategy (random vs. counter), and
whether the length prefix wraps the whole envelope or just the ciphertext is
all **TBD (observe)**. Don't guess; capture.

## 5. RPC layer — TBD (observe)

At the semantic level, the extension needs the app to do roughly:

- "Who are you? / are you unlocked? / which databases are available?" (status)
- "Give me credentials that match this URL" (the main autofill call)
- "Give me the TOTP for this entry"
- "Store a new credential" (the 'save password' flow)
- "Generate a password"

Plausible message shape (JSON inside Crypto Box):

```jsonc
// request
{ "id": "uuid", "op": "get-credentials-for-url", "args": { "url": "https://…" } }

// response
{ "id": "uuid", "ok": true, "result": [ /* entries */ ] }
// or
{ "id": "uuid", "ok": false, "error": { "code": "…", "message": "…" } }
```

But again: until we watch real messages go across, this is a hypothesis to be
tested, not a spec to be implemented. `src/protocol/messages.ts` will grow
concrete types as we observe each one.

## 6. Relationship to the SSH agent

The SSH agent interface described at
<https://strongbox.reamaze.com/kb/ssh-agent/ssh-agent> is **unrelated** to this
protocol. It speaks the standard OpenSSH agent wire format (RFC draft
`draft-miller-ssh-agent`) on a different Unix socket
(`…/group.strongbox.mac.mcguill/agent.sock`). It's useful if you need an SSH
key, but it doesn't give you password lookup. This CLI might grow a separate
`ssh` subcommand that fronts that socket, but the code is completely distinct.

## 7. What this buys us

If — and it's a real *if* — the protocol turns out to be approximately as above,
the CLI becomes a thin layer:

1. Locate the Native Messaging manifest, read `path` to find `afproxy`.
2. `Bun.spawn` afproxy with the right argv and piped stdio.
3. Generate/persist a Curve25519 keypair for ourselves.
4. Run the handshake. On first run, the user sees a Strongbox prompt.
5. For each CLI invocation, open a session, send one RPC, print the result.

Steps 1–3 are doable today from the public information. Steps 4–5 need wire
observation. See `docs/REVERSE_ENGINEERING.md` for the actual procedure.
