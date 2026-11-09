#!/usr/bin/env bash
# validate.sh <file>: fails unless <file> has exactly the shape of nix/hashes.json, so the hashes bot can only ever publish
# three SRI hashes. Used by bot-nix-hashes.yml before it commits and by check-bot-scope.yml on the bot's pull request.
# Adding a system to the flake means adding it to SYSTEMS here.
set -euo pipefail

file=${1:?usage: validate.sh <file>}
SYSTEMS='["aarch64-darwin","aarch64-linux","x86_64-linux"]'

fail() {
  echo "::error::$file: $*" >&2
  exit 1
}

if [ ! -f "$file" ] || [ -L "$file" ]; then fail "not a regular file"; fi
[ "$(wc -c < "$file")" -lt 4096 ] || fail "4096 bytes or larger"
jq -se 'length == 1' "$file" > /dev/null 2>&1 || fail "not a single JSON value"
jq -e --argjson systems "$SYSTEMS" '
  type == "object"
  and keys == ["nodeModules"]
  and (.nodeModules | type == "object")
  and (.nodeModules | keys == $systems)
  and (.nodeModules | all(.[]; type == "string" and test("\\Asha256-[A-Za-z0-9+/]{43}=\\z")))
' "$file" > /dev/null || fail "expected {\"nodeModules\": {<$SYSTEMS>: \"sha256-<44 base64 chars>\"}}"
# The canonical form rules out duplicate keys and anything else jq would drop on parse.
jq . "$file" | cmp -s - "$file" || fail "not formatted as jq . prints it"
echo "$file: valid"
