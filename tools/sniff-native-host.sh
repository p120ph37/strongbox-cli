#!/usr/bin/env bash
# Layer-A Native Messaging shim for protocol reverse-engineering.
# See docs/REVERSE_ENGINEERING.md §"Layer A".
#
# Sits between the browser and Strongbox's real afproxy binary and records
# raw framed bytes (uint32-LE length prefix + UTF-8 JSON) in both directions.
# The shim does not parse or transform bytes — it just tees them.
#
# Install:
#   1. Note the current "path" value in the Strongbox NativeMessagingHosts
#      manifest (the one whose allowed_origins contains
#      chrome-extension://mnilpkfepdibngheginihjpknnopchbn/).
#   2. Either set STRONGBOX_CLI_SNIFF_REAL=<that path> when invoking, or edit
#      the default below.
#   3. Replace the manifest's "path" with the absolute path to this script.
#   4. Restart the browser, drive one distinct operation (e.g. unlock, or one
#      autofill), then quit the browser so the host exits cleanly.
#   5. Restore the manifest's original "path".
#
# Each run writes to a fresh timestamped subdirectory so captures never clobber
# each other. Override the parent directory with STRONGBOX_CLI_SNIFF_DIR.
#
# Output per run:
#   in.bin       raw bytes from browser -> afproxy
#   out.bin      raw bytes from afproxy -> browser
#   stderr.log   afproxy's stderr (kept off the framed stream)
#   meta.txt     pid, argv, timestamp, real-binary path
#
# Commit policy: hex-dump these under docs/captures/<date>-<op>/ with a notes.md
# describing the user actions. Never commit bytes from a real vault; use a
# throwaway vault with synthetic entries. See docs/REVERSE_ENGINEERING.md
# §"What to commit" / §"What *not* to commit".

set -eu

REAL_AFPROXY="${STRONGBOX_CLI_SNIFF_REAL:-/Applications/Strongbox.app/Contents/MacOS/afproxy}"
CAPTURE_ROOT="${STRONGBOX_CLI_SNIFF_DIR:-$HOME/strongbox-sniff}"
CAPTURE_DIR="$CAPTURE_ROOT/$(date -u +%Y%m%dT%H%M%SZ)-$$"

if [[ ! -x "$REAL_AFPROXY" ]]; then
  echo "sniff-native-host: real afproxy not found or not executable:" >&2
  echo "  $REAL_AFPROXY" >&2
  echo "Set STRONGBOX_CLI_SNIFF_REAL to the path recorded in the original" >&2
  echo "NativeMessagingHosts manifest before it was swapped for this shim." >&2
  exit 127
fi

mkdir -p "$CAPTURE_DIR"

{
  printf 'date_utc=%s\n' "$(date -u +%FT%TZ)"
  printf 'pid=%s\n'      "$$"
  printf 'real=%s\n'     "$REAL_AFPROXY"
  printf 'argc=%s\n'     "$#"
  i=0
  for a in "$@"; do
    printf 'argv[%d]=%s\n' "$i" "$a"
    i=$((i + 1))
  done
} > "$CAPTURE_DIR/meta.txt"

# Pipeline:
#   browser stdout -> tee in.bin  -> afproxy stdin
#   afproxy stdout -> tee out.bin -> browser stdin
#
# tee passes bytes through unchanged; the pipes are binary-clean. afproxy's
# stderr is redirected to a file so it can never corrupt the framed stream.
tee "$CAPTURE_DIR/in.bin" \
  | "$REAL_AFPROXY" "$@" 2> "$CAPTURE_DIR/stderr.log" \
  | tee "$CAPTURE_DIR/out.bin"
