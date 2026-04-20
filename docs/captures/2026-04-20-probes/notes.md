# 2026-04-20 — synthetic messageType probe sweep

## Purpose

The Layer-D.1 MitM capture session on 2026-04-20 produced plaintext
for every `messageType` the browser extension emits during normal
use: 0, 2–7, 11–13. This left gaps at 1, 8, 9, 10, and everything
from 14 upward. The probe sweep here fires one synthetic request per
gap slot at a running Strongbox and records the server's response,
specifically so the error strings can surface the *internal class
name* Strongbox expects for that slot.

## Tool

`tools/probe-messagetypes.ts`. Reuses the MitM's client-face keypair
(already TOFU-trusted, though see also
[no-trust-prompt project memory](../../../.claude/projects/-Users-Aaron-Meriwether-strongbox-cli/memory/strongbox_no_trust_prompt.md)
— no prompt appears on current Strongbox regardless) and the real
server public key learned during the Layer-D.1 session. Spawns
`afproxy` fresh per probe. Payload is always the literal `{}` plaintext.

## Environment

- macOS Darwin 25.1.0
- Strongbox Pro 1.63.1
- afproxy at `/Applications/Strongbox.app/Contents/MacOS/afproxy`
- At least one DB unlocked at the time of the sweep (to avoid early
  "database locked" short-circuit before dispatch).

## Probes fired

Two sweeps, both covering `messageType ∈ [1..15] ∪ {100}`:

1. `{}` plaintext — triggers decode errors for ops with required fields
   but is silently accepted by ops that take no arguments.
2. `[]` plaintext — valid JSON, cannot decode into any request object,
   so every dispatched slot names its expected request class.

mt=0 (Hello) is skipped: its wire format is unencrypted and its class
name is not needed.

## Class-name inventory

| mt  | server request class         | notes                                                                 |
| --- | ---------------------------- | --------------------------------------------------------------------- |
| 1   | `SearchRequest`              | distinct from mt=2 (URL-keyed); generic search, args TBD              |
| 2   | `CredentialsForUrlRequest`   | we'd been calling this "SearchByUrl"; rename to match Strongbox       |
| 3   | `CopyFieldRequest`           | autofill-inject op                                                    |
| 4   | `LockDatabaseRequest`        | **our code had this slot as "Unlock"; it is Lock**                    |
| 5   | `UnlockDatabaseRequest`      | **our code had this slot as "Lock"; it is Unlock**                    |
| 6   | `CreateEntryRequest`         | actual create-entry action                                            |
| 7   | `CreateEntryRequest`         | reuses the same decode target as mt=6; returns groups — seems to be a "groups available to create into" op |
| 8   | `GetNewEntryDefaultsRequest` | v1 of the "prepare new entry" op                                      |
| 9   | *(empty-object accepted)*    | returns `{password, alternatives: string[]}` — multi-suggestion password generator; class name unrecovered |
| 10  | `GetIconRequest`             | favicon / entry-icon fetch                                            |
| 11  | *(empty-object accepted)*    | returns a single password; `GeneratePassword`-like; class name unrecovered |
| 12  | `handleGetPasswordStrengthRequest` | the `handle` prefix is the Objective-C method name; model class is presumably `GetPasswordStrengthRequest` |
| 13  | `GetNewEntryDefaultsRequestV2` | v2 of mt=8 — probably returns richer defaults                        |
| 14  | `GetFavouritesRequest`       | `{}` was silently accepted with `{results: []}`; `[]` got the name    |
| 15  | `CopyFieldRequest`           | same decode class as mt=3; role difference TBD                        |
| ≥16 | — ("Could not convert request to JSON") | not dispatched                                             |

The ops at mt=9 and mt=11 silently accept `{}` *and* silently accept
`[]` — i.e. they seem to ignore the request body entirely rather than
decoding it. Their class names remain unknown; class-sniffing through
error strings doesn't work for ops that never error on malformed input.

## Interpretation

- **mt=4 / mt=5 swap**: our code (before this probe session) had the
  semantics inverted. The capture session had both ops operating on the
  same database with identical `{databaseId}` request and
  `{success: true}` response, so we couldn't tell lock from unlock from
  wire traffic alone — the class name in the error is the tiebreaker.
- **mt=7**: the server decodes its request as `CreateEntryRequest` but
  the *response* is a groups list. Working hypothesis: mt=7 is the
  "get available groups to create into" companion to the actual Create
  at mt=6, and Strongbox reuses the request class because both ops
  only need a `databaseId` field.
- **mt=9 and mt=11**: both accept any payload silently. Since neither
  errors, class-sniffing doesn't work on these two. To name them we'd
  need either a Frida hook (Layer D.2) or to infer from the response
  shape (mt=11 is almost certainly the standard password generator;
  mt=9 returns a primary + alternatives so is probably a "suggest
  multiple" variant).
- **mt ≥ 16**: the "Could not convert request to JSON" error fires
  before dispatch, which is the same error you'd get for an unknown
  messageType. These slots are presumably unassigned.

## Clean-room note

All class names recorded here come from Strongbox's own runtime error
strings (stderr / decrypted response). No Strongbox source tree was
read. This observation satisfies the same clean-room standard as the
rest of `docs/captures/`.
