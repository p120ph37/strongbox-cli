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

### 4.1 Envelope shape — observed 2026-04-17

Every Native Messaging invocation is a **single request / single response**
round-trip. afproxy is spawned fresh by the browser per message and exits
after replying. There is no persistent connection, no multi-step handshake,
and no separate plaintext bootstrap exchange before encrypted traffic
begins — every envelope carries both sides' public keys and is structurally
identical.

Captured on 2026-04-17 across 94 sessions; see
`docs/captures/2026-04-17-envelope/` for raw hex dumps.

**Request envelope** (plaintext JSON, wrapped in the uint32-LE Native
Messaging frame defined in §2):

```jsonc
{
  "clientPublicKey": "<base64 32B Curve25519 public key>",
  "nonce":           "<base64 24B crypto_box nonce>",  // "" on messageType=0
  "message":         "<base64 crypto_box ciphertext>", // "message" literal on messageType=0
  "messageType":     <integer>
}
```

**Response envelope** (same framing):

```jsonc
{
  "message":         "<base64 crypto_box ciphertext>",
  "serverPublicKey": "<base64 32B Curve25519 public key>",
  "errorMessage":    "<string, empty on success>",
  "success":         <boolean>,
  "nonce":           "<base64 24B crypto_box nonce>"
}
```

The `message` body is a standard libsodium `crypto_box_easy` ciphertext:
`plaintext_length + 16` bytes (the trailing 16 is the Poly1305 tag).
Decrypt with `crypto_box_open_easy(ciphertext, nonce, serverPublicKey,
clientSecretKey)` on the client side (inverse on the server side).

**Key persistence, observed:**

- The server's public key was **identical across all 94 captures**. This is
  consistent with a long-lived server keypair (TOFU on the server side).
  Our client can persist its own keypair, transmit it once, and expect to
  be recognised on subsequent connections without re-prompting.
- The client's public key rotated across **10 distinct values** in the
  capture set. The browser extension therefore caches its keypair across
  several native-host spawns (likely scoped to popup/service-worker
  lifetime) but not forever.

**Handshake, revised:** design hypothesis (2) from the earlier draft of
this section (TOFU with persisted client identity, user accepts in the app
UI on first connection) remains the best fit for the observed UX, but
there is **no separate handshake message**. The first connection from a
given clientPublicKey is presumably what triggers the one-time "allow this
extension?" dialog; subsequent connections go through transparently. To
be confirmed when we implement from scratch.

### 4.2 `messageType = 0` — Hello

The client sends an unencrypted request: `nonce` is the empty string,
`message` is the literal ASCII string `"message"`. No `crypto_box` is
involved on the request side because the client does not yet have the
server's public key.

The server responds with a standard encrypted envelope: `message` contains
a `crypto_box` ciphertext (observed plaintext length: 438–439 bytes),
`serverPublicKey` gives us the server's long-lived pubkey, and `nonce` is
a real 24-byte nonce. From this response onward the client can encrypt
`messageType ≥ 2` requests.

The Hello response plaintext was decoded on 2026-04-20 (see §5) and
carries the database list, a server version string, and a feature-flag
bag.

### 4.3 `messageType ≥ 2` — encrypted RPC

`message` is a `crypto_box` ciphertext keyed by the stated `nonce`,
encrypting an inner JSON payload whose shape is now observed for every
`messageType` the extension emits. Inner schemas and sample payloads are
enumerated in §5.

## 5. RPC layer — observed messageTypes

Plaintext for every `messageType` the extension emits was decoded on
2026-04-20 via a back-to-back encryption MitM native host (see
`docs/REVERSE_ENGINEERING.md` §"Layer D.1 — MitM" and the capture set at
`docs/captures/2026-04-20-layerD/`). The table below summarises each
operation; subsections give the full request/response schema and a
redacted sample.

| mt | operation                  | capture dir                                    |
| -- | -------------------------- | ---------------------------------------------- |
| 0  | Hello                      | `2026-04-20-layerD/00-mt0-hello/`              |
| 2  | Search credentials by URL  | `2026-04-20-layerD/01-mt2-search-url/`         |
| 3  | Copy field (autofill)      | `2026-04-20-layerD/02-mt3-copy-field/`         |
| 4  | Unlock database            | `2026-04-20-layerD/03-mt4-unlock-db/`          |
| 5  | Lock database              | `2026-04-20-layerD/04-mt5-lock-db/`            |
| 6  | Create entry               | `2026-04-20-layerD/05-mt6-create-entry/`       |
| 7  | List groups in database    | `2026-04-20-layerD/06-mt7-list-groups/`        |
| 11 | Generate password          | `2026-04-20-layerD/07-mt11-generate-password/` |
| 12 | Check password strength    | `2026-04-20-layerD/08-mt12-check-strength/`    |
| 13 | Prepare create-entry form  | `2026-04-20-layerD/09-mt13-prepare-new-entry/` |

Integer values 1, 8, 9, 10, and anything ≥ 14 were **not** observed on
the wire; whether they exist and map to ops we haven't triggered is open.

### 5.1 `mt = 0` — Hello

Request: literal bytes `"message"` in the envelope (no inner JSON).

Response:

```jsonc
{
  "databases": [
    { "uuid": "…", "nickName": "vault-a",
      "locked": true,  "autoFillEnabled": true, "includeFavIconForNewEntries": true },
    { "uuid": "…", "nickName": "test",
      "locked": false, "autoFillEnabled": true, "includeFavIconForNewEntries": true }
  ],
  "serverVersionInfo": "1.63.1",
  "serverSettings": {
    "colorBlindPalette":  false,
    "supportsCreateNew":  true,
    "markdownNotes":      true,
    "colorizePasswords":  true
  }
}
```

### 5.2 `mt = 2` — Search credentials by URL

Request: `{ "url": "...", "skip": 0, "take": 9 }` (observed pagination
values; larger `take` untested).

Response: `{ "results": [...], "unlockedDatabaseCount": <int> }`. Every
capture we have returned `results: []`; the element type is therefore
**unconfirmed** — typed as `unknown[]` in `src/protocol/messages.ts`
until a non-empty search is captured. Best guess is `Credential[]` (see
§5.6).

### 5.3 `mt = 3` — Copy field

The extension asks the server to inject a specific field of a specific
entry via the OS paste/keyboard path. The response only confirms success;
the value is not returned.

Request:

```jsonc
{
  "databaseId":   "…",   // UUID of an unlocked database
  "nodeId":       "…",   // UUID of the entry within that database
  "explicitTotp": false,
  "field":        2      // integer selector; 2 = password (only value observed)
}
```

Response: `{ "success": true }`.

### 5.4 `mt = 4` — Unlock database &nbsp;·&nbsp; `mt = 5` — Lock database

Request for both: `{ "databaseId": "…" }`.
Response for both: `{ "success": true }`.

Unlocking a locked database triggers the Strongbox UI to prompt for the
master password; the native host doesn't return until that flow resolves.

### 5.5 `mt = 6` — Create entry

Request:

```jsonc
{
  "databaseId": "…",
  "groupId":    "…",                      // from mt=7 ListGroups
  "icon":       "data:image/png;base64,…", // PNG data URL; ~5 KiB typical
  "title":      "…",
  "username":   "…",
  "password":   "…",
  "url":        "…"
}
```

Response: `{ "uuid": "…", "credential": <Credential> }` where
`Credential` has the full set of fields shown in §5.6.

### 5.6 `Credential` record (used by mt=6 response and likely mt=2)

```jsonc
{
  "uuid":                "…",
  "databaseId":          "…",
  "databaseName":        "test",
  "title":               "…",
  "username":            "…",
  "password":            "…",
  "url":                 "…",
  "totp":                "",               // empty when unset
  "notes":               "",
  "favourite":           false,
  "tags":                [],
  "customFields":        [],               // element shape unconfirmed
  "attachmentFileNames": [],
  "icon":                "data:image/png;base64,…",
  "modified":            "Today at 5:17 PM" // human-formatted; NOT ISO 8601
}
```

### 5.7 `mt = 7` — List groups

Request: `{ "databaseId": "…" }`.
Response: `{ "groups": [ { "uuid": "…", "title": "…" }, … ] }`.

### 5.8 `mt = 11` — Generate password

Request: `{}`. Response:

```jsonc
{
  "password":     { "password": "…", "strength": { "entropy": 84.3, "category": "Strong", "summaryString": "Strong (15 / 84.3 bits / >100m years)" } },
  "alternatives": [
    { "password": "…", "strength": { "entropy": 88.7, "category": "Strong", "summaryString": "…" } }
    /* …N more alternates; exact N not established… */
  ]
}
```

### 5.9 `mt = 12` — Check password strength

Request: `{ "password": "…" }` (the extension sends one request per
keystroke in the password field, so expect N invocations for an
N-character typed password).

Response: `{ "strength": { "entropy": 10.2, "category": "Very Weak", "summaryString": "Very Weak (3 / 10.2 bits / 0s)" } }`.

### 5.10 `mt = 13` — Prepare create-entry form

Loaded once when the create-entry UI opens, to preseed username and
password fields.

Request: `{ "databaseId": "…" }`. Response:

```jsonc
{
  "mostPopularUsernames": ["username", "tomsmith"],
  "username":             "username",
  "password": {
    "password": "…",
    "strength": { "entropy": 93.3, "category": "Strong", "summaryString": "…" }
  }
}
```

### 5.11 Typed projection

`src/protocol/messages.ts` mirrors this §5 exactly: one
`<Op>Request` / `<Op>Response` pair per messageType, a shared
`Credential`, `GeneratedPassword`, `PasswordStrength`, `DatabaseSummary`,
and `ServerSettings`, and an `RpcTypeMap` keyed on `MessageType` that
lets callers do `rpc<K>(mt, request)` with a correctly-narrowed return.
`src/protocol/guards.ts` carries the matching runtime validators.

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
