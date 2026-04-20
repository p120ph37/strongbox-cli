#!/usr/bin/env bash
# Wrapper that Chrome Native Messaging launches. Resolves `bun` with an
# absolute path so it works under Chrome's minimal subprocess environment,
# and passes through the extension-origin argv and the browser's stdio.
#
# To install as a MitM host:
#   1. Edit this file's BUN_PATH below if `command -v bun` isn't where you
#      want it resolved from at install time.
#   2. chmod +x tools/mitm-afproxy.sh tools/mitm-afproxy.ts
#   3. Put this script's absolute path in the NativeMessagingHosts manifest.
#   4. Export STRONGBOX_CLI_MITM_REAL to the original afproxy path *in the
#      manifest's environment*, either by editing this wrapper to hard-code
#      it or by using a launchd plist. Chrome itself does not forward the
#      invoking shell's environment to the native host.

set -eu

# Resolve bun by absolute path: Chrome launches native hosts under
# launchd's minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), which does not
# include ~/.bun/bin, so `command -v bun` returns empty in that context.
# Edit the default below if your bun lives elsewhere.
BUN_PATH="${BUN_PATH:-/Users/Aaron.Meriwether/.bun/bin/bun}"
if [[ -z "$BUN_PATH" || ! -x "$BUN_PATH" ]]; then
  echo "mitm-afproxy.sh: can't find bun; set BUN_PATH to its absolute path" >&2
  exit 127
fi

# If STRONGBOX_CLI_MITM_REAL isn't already exported, fall back to the
# standard install location. Override by exporting it before Chrome launches.
: "${STRONGBOX_CLI_MITM_REAL:=/Applications/Strongbox.app/Contents/MacOS/afproxy}"
export STRONGBOX_CLI_MITM_REAL=/Applications/Strongbox.app/Contents/MacOS/afproxy

DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$BUN_PATH" "$DIR/mitm-afproxy.ts" "$@"
