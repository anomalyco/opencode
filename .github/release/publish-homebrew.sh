#!/usr/bin/env bash
# publish-homebrew.sh <sign-macos dir> <build-archives dir>: updates opencode-v2 in anomalyco/homebrew-tap
# (HOMEBREW_TOKEN) and registers the homebrew update artifact.
. "$(dirname "$0")/lib.sh"

push_git "https://x-access-token:${HOMEBREW_TOKEN:-}@github.com/anomalyco/homebrew-tap.git" \
  "chore: update opencode-v2 to $OPENCODE_VERSION" bash "$release_dir/render-homebrew.sh" "$1" "$2"
publish_update cli homebrew '{"package": "anomalyco/tap/opencode-v2"}'
