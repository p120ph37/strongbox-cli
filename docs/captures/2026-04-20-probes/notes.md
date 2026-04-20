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

`[1, 8, 9, 10, 14, 15, 16, 17, 18, 19, 20, 100]` — twelve slots total.

## Results

Raw per-probe output in `probes.jsonl`. Summarised:

| mt  | success | server response                                                 |
| --- | ------- | --------------------------------------------------------------- |
| 1   | false   | `"Can't decode SearchRequest from message JSON"`                |
| 8   | false   | `"Can't decode GetNewEntryDefaultsRequest from message JSON"`   |
| 9   | true    | `{"password":"...","alternatives":[5 more strings]}`            |
| 10  | false   | `"Can't decode GetIconRequest from message JSON"`               |
| 14  | true    | `{"results":[]}`                                                |
| 15  | false   | `"Can't decode CopyFieldRequest from message JSON"`             |
| 16+ | false   | `"Could not convert request to JSON"`                           |

## Interpretation

- **mt 1, 8, 10, 15**: dispatched, but rejected because `{}` doesn't
  decode into the expected request class. The class name is in the
  error string — this is information we didn't have before.
- **mt 9**: accepts empty input. Returns one primary password plus five
  alternatives. Distinct from mt=11 which returns a single password.
  Probably drives the "password generator" UI's multi-suggestion mode.
- **mt 14**: accepts empty input. Returns `{results: []}`. The shape
  suggests a search / list op; required arguments unknown.
- **mt ≥ 16**: the generic "Could not convert request to JSON" error
  hits *before* dispatch, which is the same error you'd get for an
  unknown messageType. These slots are presumably unassigned.

## Clean-room note

All class names recorded here come from Strongbox's own runtime error
strings (stderr / decrypted response). No Strongbox source tree was
read. This observation satisfies the same clean-room standard as the
rest of `docs/captures/`.
