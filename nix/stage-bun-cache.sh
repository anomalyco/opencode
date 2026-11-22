#!/usr/bin/env bash
set -euo pipefail

cache=$1
dest=$2
cd "$cache"
# Nix links each package root into the cache, including under scope directories.
# Follow those links, not the links inside their extracted payloads.
find . -type l -print0 | while IFS= read -r -d '' package; do
  mkdir -p "$dest/${package%/*}"
  cp -RH -- "$package" "$dest/$package"
done
chmod -R u+w "$dest"
