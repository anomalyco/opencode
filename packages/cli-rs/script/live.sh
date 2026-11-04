#!/bin/sh
# Runs opencode-rs against the elected opencode background service, as the root `dev:live` does for the
# TypeScript TUI: the dev storage channel, the service's URL, and its private password.
#
# Usage: script/live.sh [opencode-rs arguments...]
set -eu

rs=$(cd "$(dirname "$0")/.." && pwd)
server=$(opencode service status)
OPENCODE_PASSWORD=$(opencode service get password)
OPENCODE_TUI_CHANNEL=dev
export OPENCODE_PASSWORD OPENCODE_TUI_CHANNEL
# Builds from the workspace so cargo reads .cargo/config.toml, then runs in the caller's directory.
(cd "$rs" && cargo build --quiet --bin opencode-rs)
exec "$rs/target/debug/opencode-rs" "$@" --server "$server"
