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

The manifest filename is **`com.markmcguill.strongbox.json`** (observed), and
`path` points at **`/Applications/Strongbox.app/Contents/MacOS/afproxy`**
(confirmed on disk). We discover this at runtime by reading the manifest. The
extension's Chrome Web Store ID is `mnilpkfepdibngheginihjpknnopchbn`.

**Manifest presence tracks the "Enable Chrome & Firefox AutoFill extension"
master switch** _(observed 2026-08-11)_. Strongbox installs this manifest when
the setting is on and **removes it when off** — the same switch that stops the
proxy (§3). So on a client, a missing manifest is the normal, expected signal
that browser autofill is disabled, not necessarily that Strongbox is absent;
distinguish the two by checking whether `Strongbox.app` exists.

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
RPC protocol (see §6).

The autofill socket is **`F`**, `AF_UNIX`/`SOCK_STREAM`, in the same group
container:

```
~/Library/Group Containers/group.strongbox.mac.mcguill/F
```

Identified by interposition (rename `F` to `F.real`, bind a proxy at `F`, forward
verbatim — the listener keeps the inode). Findings:

- **Inner framing is raw JSON, no length prefix.** afproxy strips the stdio
  side's uint32-LE prefix; on this hop it writes the bare Hello JSON (113 bytes).
- **The proxy is bound at app launch**, gated by the "Enable Chrome & Firefox
  AutoFill extension" master switch (`runBrowserAutoFillProxyServer-Prod-22-Oct-2022`),
  independent of vault state or per-database autofill. When that switch is off,
  Strongbox stops listening on `F` and uninstalls the Native Messaging manifest
  (§2), so a client fails at manifest discovery. The SSH agent (`runSshAgent`) is
  a separate switch, unaffected.

### 3.1 `F` accepts third-party clients

A non-Strongbox process can speak this protocol directly to `F`: opening it and
writing a raw-JSON `messageType=0` Hello returns a full response envelope that
decrypts against our client identity. There is no peer-identity gate.

Not used by this CLI — a correctly-framed write is served fine, but a mis-framed
one (e.g. with the stdio length prefix) wedges Strongbox's accept loop until
restart, and the ~100 ms/RPC that direct mode would save is negligible. The stdio
path via afproxy is the supported surface; direct-to-`F` is documented as
possible, not chosen.

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
  be recognized on subsequent connections without re-prompting.
- The client's public key rotated across **10 distinct values** in the
  capture set. The browser extension therefore caches its keypair across
  several native-host spawns (likely scoped to popup/service-worker
  lifetime) but not forever.

**Handshake, revised (2026-04-20):** there is **no separate handshake
message** — the Hello envelope (`messageType=0`, see §4.2) doubles as
key exchange. The earlier hypothesis that Strongbox pops a one-time
"allow this extension?" dialog on first sight of a new client public
key **was not observed**: during the Layer-D.1 MitM session on
2026-04-20, Strongbox 1.63.1 silently accepted a fresh client-face
keypair that it had never seen before. No UI prompt appeared at any
point during unlock / autofill / create-entry / lock flows. Persisting
the client keypair client-side is therefore good hygiene (and future-
proofs against a newer Strongbox adding the prompt) but offers no
observable benefit against the current server version.

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
`docs/captures/2026-04-20-layerD/`). The table below summarizes each
operation; subsections give the full request/response schema and a
redacted sample.

Names in this section match the Strongbox-internal request-class names
recovered on 2026-04-20 from the dispatcher's "Can't decode <ClassName>
from message JSON" error strings (see §5.0 below); the only editorial
deviations are `Hello` (mt=0, has no class name on the wire) and
`ListGroups` (mt=7, where the operation returns groups but Strongbox
decodes the request as `CreateEntryRequest`).

| mt  | operation                | server-side class                        | capture dir                                    |
| --- | ------------------------ | ---------------------------------------- | ---------------------------------------------- |
| 0   | Hello                    | _(special — see §4.2)_                   | `2026-04-20-layerD/00-mt0-hello/`              |
| 2   | CredentialsForUrl        | `CredentialsForUrlRequest`               | `2026-04-20-layerD/01-mt2-search-url/`         |
| 3   | CopyField                | `CopyFieldRequest`                       | `2026-04-20-layerD/02-mt3-copy-field/`         |
| 4   | LockDatabase             | `LockDatabaseRequest`                    | `2026-04-20-layerD/03-mt4-lock-db/`            |
| 5   | UnlockDatabase           | `UnlockDatabaseRequest`                  | `2026-04-20-layerD/04-mt5-unlock-db/`          |
| 6   | CreateEntry              | `CreateEntryRequest`                     | `2026-04-20-layerD/05-mt6-create-entry/`       |
| 7   | ListGroups _(editorial)_ | `CreateEntryRequest` (reused)            | `2026-04-20-layerD/06-mt7-list-groups/`        |
| 11  | GeneratePassword         | _(unnamed — accepts any input silently)_ | `2026-04-20-layerD/07-mt11-generate-password/` |
| 12  | GetPasswordStrength      | `handleGetPasswordStrengthRequest`       | `2026-04-20-layerD/08-mt12-check-strength/`    |
| 13  | GetNewEntryDefaultsV2    | `GetNewEntryDefaultsRequestV2`           | `2026-04-20-layerD/09-mt13-prepare-new-entry/` |

### 5.0 Probe sweep — slots not seen during normal extension use

A synthetic probe sweep on 2026-04-20 (see `tools/probe-messagetypes.ts`
and `docs/captures/2026-04-20-probes/probes.jsonl`) sent two payloads —
`{}` and `[]` — to every messageType in `[1..15] ∪ {100}`. The `[]`
payload is valid JSON but cannot decode into any request object, so
every dispatched slot names its expected class via the resulting error.
The sweep recovered the names listed in the table above and additionally
mapped the slots not driven by the extension UI:

| mt  | server-side class               | notes                                                                                                                                                                  |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `SearchRequest`                 | **schema confirmed** — `{query}`; see §5.1a                                                                                                                            |
| 8   | `GetNewEntryDefaultsRequest`    | v1 of mt=13 `GetNewEntryDefaultsRequestV2`; likely `{databaseId}`, unconfirmed                                                                                         |
| 9   | _(unnamed — accepts any input)_ | returns `{password, alternatives: string[]}` — a multi-suggestion variant of `GeneratePassword`                                                                        |
| 10  | `GetIconRequest`                | favicon / entry-icon fetch; request schema TBD                                                                                                                         |
| 14  | `GetFavouritesRequest`          | **schema confirmed** — request `{}`, response `{results: Credential[]}`; see §5.12                                                                                     |
| 15  | `CopyFieldRequest`              | names the same class as mt=3 but **rejects** mt=3's exact field set (`{databaseId,nodeId,explicitTotp,field}`) — needs a different/richer payload; role still unmapped |
| ≥16 | —                               | `errorMessage="Could not convert request to JSON"` — slot not dispatched                                                                                               |

Since this sweep, mt = 1 and mt = 14 have had their full schemas recovered
(see §5.1a and §5.12) — mt=1's `query` field by guess-and-check against the
decode error, mt=14 by driving it directly. Still TBD: mt = 8, 10, 15. mt = 9
and mt = 11 silently accept any payload and so cannot be named via this method.
All class names come from Strongbox's runtime error strings; the Strongbox
source tree was not read.

> Caveat: the **mt=4 / mt=5 ordering** (Lock = 4, Unlock = 5) was
> originally inverted in this document and in the type system. The
> capture session at `03-mt4-lock-db/` and `04-mt5-unlock-db/` shows
> identical `{databaseId}` request and `{success: true}` response
> for both ops, so wire traffic alone cannot distinguish them. The
> server's class names are the tiebreaker.

### 5.1 `mt = 0` — Hello

Request: literal bytes `"message"` in the envelope (no inner JSON).

Response:

```jsonc
{
  "databases": [
    {
      "uuid": "…",
      "nickName": "vault-a",
      "locked": true,
      "autoFillEnabled": true,
      "includeFavIconForNewEntries": true,
    },
    {
      "uuid": "…",
      "nickName": "test",
      "locked": false,
      "autoFillEnabled": true,
      "includeFavIconForNewEntries": true,
    },
  ],
  "serverVersionInfo": "1.63.1",
  "serverSettings": {
    "colorBlindPalette": false,
    "supportsCreateNew": true,
    "markdownNotes": true,
    "colorizePasswords": true,
  },
}
```

**`autoFillEnabled` reflects the per-database "Enable AutoFill for this
Database" setting, and it is a hard gate on entry visibility** _(observed
2026-08-11)_. A database with `autoFillEnabled: false` is **still listed here**
(not omitted, not shown empty — the summary carries no entry count), but **none
of its entries appear in any entry-query path**: mt=1 search, mt=2
CredentialsForUrl, and mt=14 favourites all exclude them. This is strictly
broader than the per-entry "Do not suggest in autofill" of §5.2, which filters
mt=2 only. `locked` is independent — the observed DB was `locked:false,
autoFillEnabled:false`.

Consequence for a client: a database can be present in this list yet have
zero reachable entries. `list` (which surfaces this array) can therefore show a
database whose entries `search`/`get`/`totp` cannot find — inherent to the
afproxy interface, which only exposes autofill-enabled databases' entries.

### 5.1a `mt = 1` — Search _(confirmed 2026-08-10)_

Generic full-text search, distinct from the URL-keyed mt=2. The extension UI
never drives it, so no MitM capture exists; the schema was recovered by
issuing requests from this project's own client against the real server and,
for the field name, guess-and-check against the decode error (see
`docs/captures/2026-08-10-direct/`).

Request: `{ "query": "...", "skip": 0, "take": 200 }`. Only `query` is
required — Strongbox's `SearchRequest` decodes from that alone. `query: ""`
matches everything.

Response: `{ "results": Credential[] }` — the `Credential` record of §5.6. No
`unlockedDatabaseCount` here, unlike mt=2.

Behavior worth knowing:

- **`take` is clamped to ~64 server-side** (`take: 5000` still returns 64), so
  the full result set is only reachable by **paging on `skip`**: advance `skip`
  by the count returned, stop on the first empty page (verified across a
  244-entry vault, no duplicates). A single large `take` silently truncates.
- Matching is full-text over `title`, `username`, `notes`, and **custom-field
  values** — so it can hit on secret material — but **not** `uuid`. UUID
  resolution therefore requires enumerating (`query: ""` + `skip` paging).
- Only unlocked, autofill-enabled databases contribute entries.

### 5.2 `mt = 2` — CredentialsForUrl

Request: `{ "url": "...", "skip": 0, "take": 9 }`. The extension always
sends `take: 9`; larger values are untested. `skip` genuinely paginates —
`11-mt2-results-paginated/` issues `skip: 2` against a two-result match
and gets `results: []` back.

Response: `{ "results": [...], "unlockedDatabaseCount": <int> }`.

`results` is **confirmed `Credential[]`** (see §5.6) as of the non-empty
captures landed on 2026-08-10: `10-mt2-results-two/` (two matches) and
`12-mt2-results-three/` (three). Field-for-field the records match §5.6
with no drift across all 41 credential records in the capture set.

`unlockedDatabaseCount` counts **unlocked databases, not results** — it
reads `1` alongside both empty and non-empty `results`, and `0` when
every database is locked. Do not use it as a result count.

Two behaviors worth relying on / not relying on:

- **Matching is host-scoped, not path-scoped.** Queries for `/login`,
  `/secure`, and `/` on the same host all return the same entries, and an
  entry whose stored URL is `…/blah` matches a query for `/`. Callers
  should not expect the server to narrow by path.
- **Result order is not stable.** The same two entries came back as
  `[Untitled, The Internet]` and as `[The Internet, Untitled]` across
  captures minutes apart, with no intervening edit. Never address a
  result by index; match on `uuid`.

**The per-entry "Do not suggest in autofill" setting filters mt=2 only**
_(observed 2026-08-11)_. Enabling it removes the entry from mt=2 results while
it stays visible via mt=1 search and mt=14 favourites. It is not exposed in the
`Credential` record — its only observable effect is absence from mt=2 — so a
client cannot detect it. For this CLI that split is correct: `url` (mt=2)
inherits the suppression; the explicit `search`/`get`/`totp`/`copy` (mt=1)
lookups still reach the entry.

### 5.3 `mt = 3` — CopyField

Writes one field of an entry to the **OS clipboard** (confirmed by canary
read-back — not keystroke injection, no focus-stealing). The response only
confirms success; the value goes to the clipboard, not back over the wire.

Request:

```jsonc
{
  "databaseId": "…", // UUID of an unlocked database
  "nodeId": "…", // UUID of the entry within that database
  "explicitTotp": false,
  "field": 1, // integer selector; see the enum below
}
```

Response: `{ "success": true }`. An unknown `field` returns `{ "success": false }`.

`field` enum, recovered by clipboard read-back against a known entry:

| field | copies                                            |
| ----- | ------------------------------------------------- |
| 0     | username                                          |
| 1     | password                                          |
| 2     | **TOTP** — the current code, computed server-side |
| ≥3    | rejected (`success: false`)                       |

Notes:

- For `field: 2`, Strongbox computes the live code server-side and copies
  _that_ (not the secret); it matched our RFC 6238 computation to the digit.
- **`explicitTotp: true` means "user explicitly requested the code"** and
  overrides Strongbox's per-database `autoFillCopyTotp` preference. With that
  preference off, `field: 2` copies only when `explicitTotp: true` (`false`
  returns `success: true` but writes nothing). So a client wanting the code
  unconditionally (as `copy --field totp` does) must send `true`.

### 5.4 `mt = 4` — LockDatabase &nbsp;·&nbsp; `mt = 5` — UnlockDatabase

Request for both: `{ "databaseId": "…" }`.
Response for both: `{ "success": true }`.

The two ops are wire-indistinguishable — both shapes are identical, and
the captures at `03-mt4-lock-db/` and `04-mt5-unlock-db/` were
disambiguated only via the dispatcher's class names recovered by the
probe sweep (§5.0). Unlocking a locked database triggers the Strongbox
UI to prompt for the master password; the native host doesn't return
until that flow resolves.

### 5.5 `mt = 6` — CreateEntry

Request:

```jsonc
{
  "databaseId": "…",
  "groupId": "…", // from mt=7 ListGroups
  "icon": "data:image/png;base64,…", // PNG data URL; ~5 KiB typical
  "title": "…",
  "username": "…",
  "password": "…",
  "url": "…",
}
```

Response: `{ "uuid": "…", "credential": <Credential> }` where
`Credential` has the full set of fields shown in §5.6.

**This is the only write op, and it only creates.** The request carries just
those seven fields — no entry id (the server assigns a fresh UUID), and no
`notes`/`totp`/`tags`/`customFields`, so those cannot be set at creation. `icon`
may be `""` (Strongbox stores no icon then). There is **no update or delete
messageType** anywhere in the dispatch surface (mt=0–15), so entries can be
created but not edited or removed over this protocol — those remain Strongbox-app
operations. `serverSettings.supportsCreateNew` (Hello) gates create.

### 5.6 `Credential` record (used by mt=6 response and likely mt=2)

```jsonc
{
  "uuid": "…",
  "databaseId": "…",
  "databaseName": "test",
  "title": "…",
  "username": "…",
  "password": "…",
  "url": "…",
  "totp": "", // otpauth:// URI, or "" when unset
  "notes": "",
  "favourite": false,
  "tags": [],
  "customFields": [
    // {key,value,concealable}; see below
    { "key": "cf-first", "value": "…", "concealable": false },
  ],
  "attachmentFileNames": [], // FILTERED — see §5.6 filters
  "icon": "data:image/png;base64,…",
  "modified": "Today at 5:17 PM", // locale-formatted; NOT ISO 8601
}
```

Confirmed against all 41 credential records in the capture set (mt=2
results and the mt=6 response). Notes on the fields that surprise:

- **`totp` is an `otpauth://` URI, not a live code.** Observed form:
  `otpauth://totp/<label>?secret=…&algorithm=SHA1&digits=6&period=30`.
  The server hands over the shared secret and expects the client to
  compute the digits. This is why a `totp` command needs no messageType
  of its own — mt=2 already carries everything.
  - The URI is **re-synthesized, not byte-preserved**: recognized OTP params
    (`secret`/`algorithm`/`digits`/`period`/`issuer`/`encoder`/account)
    round-trip, but Strongbox normalizes order/defaults and drops unknown
    params. Non-default values survive; exact-string fidelity does not.
  - **Steam Guard** is carried as `…&encoder=steam&digits=5` (both a pasted
    Steam URL and Strongbox's native Steam mode). Clients must special-case
    `encoder=steam`: 5 symbols base-26 over `23456789BCDFGHJKMNPQRTVWXY`, not
    decimal (`src/util/totp.ts`, verified against Strongbox's own code).
- **`icon` is a `data:image/png;base64,…` URI running to several KB**
  (5,622 chars on one observed record). It dominates the byte size of a
  response. Don't inline it in default CLI output.
- **`modified` is locale-formatted for display**, and switches between
  relative and absolute forms — both `"Today at 5:17 PM"` and
  `"Apr 17, 2026 at 1:45 PM"` were observed in the same capture set.
  It is not machine-parseable; treat it as an opaque display string.
- **`customFields` elements are `{ key, value, concealable }`** _(confirmed
  2026-08-10)_. `concealable` is a **display hint only** — Strongbox marks a
  field sensitive so a UI can mask it, but **the `value` is still sent in the
  clear**. Do not read `concealable: true` as "value withheld"; nothing is
  withheld. `tags` and `attachmentFileNames` are confirmed `string[]`.
  - `concealable` is exactly the KDBX per-string **`Protected`
    (memory-protection) attribute** — confirmed 2026-08-11 by matching the wire
    flag field-for-field against the raw vault. It carries no access control,
    only that memory-protection bit.
  - **Structured entry types are not modelled on the wire.** A Strongbox
    "Credit Card" entry arrives as an ordinary `Credential` whose card data is
    plain custom fields (`CardNumber`, `CVV`, `PIN`, `ExpiryDate`, …), all
    transmitted; the card number is also copied into the standard `password`
    field (and the cardholder into `username`). Nothing is filtered the way SSH
    material is, and no marker identifies the entry as a card — a client can
    only infer the type from the conventional key names.

#### The server serves a _filtered_ view, not the raw entry

_(Confirmed 2026-08-10 by diffing the wire against the KDBX file for one
entry.)_ Four fields are curated by Strongbox before transmission — a client
that treats them as the entry's full contents will be wrong:

| field                 | dropped from the wire view                                       |
| --------------------- | ---------------------------------------------------------------- |
| `attachmentFileNames` | SSH-agent material — `id_ed25519`, `KeeAgent.settings`           |
| `customFields`        | reserved 2FA/meta keys — `otp`, `TimeOtp-Secret-Base32`, `Email` |
| `tags`                | the `Favorite` tag (surfaced instead as `favourite: bool`)       |
| mt=7 `groups`         | the Recycle Bin and its descendants                              |

Consequences: **you cannot discover an entry's SSH key over this protocol**
(§6.2); the `TimeOtp-Secret-Base32` custom field is consumed to synthesize the
`totp` URI rather than passed through; and "searchable group" (which excludes
the Recycle Bin) is an app-wide visibility rule, the same one the SSH agent
applies (§6.1).

Adding a TOTP writes both the native `TimeOtp-Secret-Base32` and a
KeePassXC-style `otp` field (a full `otpauth://` URI) into the KDBX; both are
filtered from the wire (a Steam entry stores only `otp`, which the native format
can't encode). Strongbox's 2FA-export app settings had no observable effect on
either the stored `otp` field or the wire.

**`Credential.totp` is synthesized from the stored secret and was populated in
every state tested** — it is the single, reliable TOTP signal on the wire, since
the raw secret fields are filtered.

### 5.7 `mt = 7` — ListGroups _(editorial name)_

Request: `{ "databaseId": "…" }`.
Response: `{ "groups": [ { "uuid": "…", "title": "…" }, … ] }`.

**The hierarchy is flattened** _(confirmed 2026-08-10)_. A nested group comes
back with `title` set to its full `/`-joined path — a vault with `Parent`
containing `Child` yields `"Parent"` and `"Parent/Child"` as sibling entries,
with no parent reference. The root group appears as `"Database"`. The Recycle
Bin and its descendants are omitted (see the §5.6 filter table). A group title
containing a literal `/` is therefore ambiguous against this encoding.

Strongbox decodes this request through the **same** `CreateEntryRequest` class
as mt=6 (both only need `databaseId`), so this doc uses the editorial name
`ListGroups` to reflect what the op does rather than its decode target.

### 5.8 `mt = 11` — GeneratePassword

Request: `{}`. Response:

```jsonc
{
  "password": {
    "password": "…",
    "strength": {
      "entropy": 84.3,
      "category": "Strong",
      "summaryString": "Strong (15 / 84.3 bits / >100m years)",
    },
  },
  "alternatives": [
    {
      "password": "…",
      "strength": { "entropy": 88.7, "category": "Strong", "summaryString": "…" },
    },
    /* …N more alternates; exact N not established… */
  ],
}
```

### 5.9 `mt = 12` — GetPasswordStrength

Request: `{ "password": "…" }` (the extension sends one request per
keystroke in the password field, so expect N invocations for an
N-character typed password).

Response: `{ "strength": { "entropy": 10.2, "category": "Very Weak", "summaryString": "Very Weak (3 / 10.2 bits / 0s)" } }`.

### 5.10 `mt = 13` — GetNewEntryDefaultsV2

Loaded once when the create-entry UI opens, to preseed username and
password fields. Strongbox calls this `GetNewEntryDefaultsRequestV2`;
mt=8 (`GetNewEntryDefaultsRequest`, no V2 suffix) is presumably the
older variant — its request and response shapes are unobserved.

Request: `{ "databaseId": "…" }`. Response:

```jsonc
{
  "mostPopularUsernames": ["username", "tomsmith"],
  "username": "username",
  "password": {
    "password": "…",
    "strength": { "entropy": 93.3, "category": "Strong", "summaryString": "…" },
  },
}
```

### 5.11 `mt = 14` — GetFavourites _(confirmed 2026-08-10)_

Returns the favourited entries. Not driven by the extension UI; captured
directly from this project's client (`docs/captures/2026-08-10-direct/`).

Request: `{}` (a literal empty object — Strongbox's `GetFavouritesRequest`
decodes from it).

Response: `{ "results": Credential[] }` — the same record and the same
filtered view as mt=1/mt=2 (see §5.6). As with mt=1 there is no
`unlockedDatabaseCount`. Membership tracks the `Favorite` tag that §5.6 shows
being lifted out of `tags` into the `favourite` boolean.

### 5.12 Typed projection

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
`draft-miller-ssh-agent`) on a different Unix socket. There is no
Strongbox-specific protocol involved — any OpenSSH-compatible client works
unmodified. It carries keys only; it will not do password lookup.

Documented here for completeness. Fronting this socket is **out of scope** for
this CLI: an SSH client that already speaks the agent protocol needs nothing
from us.

### 6.1 How the keys are stored

SSH keys live inside ordinary entries, using the **KeeAgent** convention from
the KeePass ecosystem rather than anything Strongbox invented — two attachments
on the entry:

| attachment          | contents                                  |
| ------------------- | ----------------------------------------- |
| `id_ed25519`        | the private key, standard OpenSSH format  |
| `KeeAgent.settings` | XML sidecar marking the key agent-enabled |

Per the KB, Strongbox offers a key only if it uses RSA or ED25519, is stored in
standard OpenSSH format, has _"Enabled for SSH Agent"_ turned on for that entry,
and sits in a **searchable group** — explicitly _not_ the Recycle Bin. That last
condition is the same visibility rule §5.7 shows mt=7 applying when it omits the
Recycle Bin from the group list, so "searchable group" is an app-wide concept
rather than an autofill-specific filter.

### 6.2 The autofill protocol hides these attachments

An entry holding an SSH key reports only its _non-key_ attachments over
mt=1/mt=2 — `KeeAgent.settings` and `id_ed25519` are omitted from
`attachmentFileNames` (§5.6 filter table). So **you cannot discover an entry's
SSH key through this protocol at all**; the attachment list is a filtered view,
not an inventory.

### 6.3 Reaching the agent

The feature is off by default and is enabled app-wide at _App Preferences → SSH
Agent_ (Pro, macOS, KeePass 2.x databases only). The per-entry
_"Enabled for SSH Agent"_ toggle does **not** switch it on by itself — with the
app-level setting off, no socket is created.

Once enabled, the socket appears at:

```
~/Library/Group Containers/group.strongbox.mac.mcguill/agent.sock
```

Clients reach it the ordinary way. The path contains spaces, so it must be
quoted; `ssh` expands the `~` inside the quotes:

```sshconfig
Host *
  IdentityAgent "~/Library/Group Containers/group.strongbox.mac.mcguill/agent.sock"
```

`IdentityAgent` replaces the _agent_ for matching hosts; `IdentityFile` is
unaffected, so on-disk keys keep working. Git ignores `IdentityAgent` entirely,
so commit signing needs the environment variable instead:

```sh
export SSH_AUTH_SOCK="$HOME/Library/Group Containers/group.strongbox.mac.mcguill/agent.sock"
```

Operational caveat: the agent only serves keys from **unlocked** databases. When
the database locks, `ssh-add -l` reports no identities and any SSH attempt
silently loses that key.

## 7. What this buys us

The protocol above is implemented, and the CLI is a thin layer over it:

1. Locate the Native Messaging manifest, read `path` to find `afproxy`.
2. `Bun.spawn` afproxy with the right argv and piped stdio.
3. Generate/persist a Curve25519 keypair for ourselves.
4. Exchange keys via the `messageType=0` Hello (no separate handshake, no
   approval prompt on current Strongbox).
5. Per invocation: open a session, send one RPC, print the result.

See `docs/REVERSE_ENGINEERING.md` for the observation procedure that got us here.
