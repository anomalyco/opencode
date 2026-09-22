#!/bin/bash
# ========================================
# LingxiCode Offline Launcher (Linux)
# ========================================

SCRIPT_DIR=$(cd $(dirname $0) && pwd)
export OPENCODE_CONFIG_DIR=$SCRIPT_DIR/config
export OPENCODE_PARSERS_DIR=$SCRIPT_DIR/parsers
export OPENCODE_DISABLE_AUTOUPDATE=true
export OPENCODE_DISABLE_MODELS_FETCH=true
export OPENCODE_DISABLE_LSP_DOWNLOAD=true
# Offline switch: block npm from fetching dependencies from remote registries.
# Set NPM_CONFIG_OFFLINE=false before launching to allow network access.
export NPM_CONFIG_FETCH_RETRIES=0
export NPM_CONFIG_OFFLINE="${NPM_CONFIG_OFFLINE:-true}"
export NPM_CONFIG_AUDIT="${NPM_CONFIG_AUDIT:-false}"
export OMO_DISABLE_POSTHOG=1
export OPENCODE_SCAN_DIR_PLUGINS=0
# Preseed dependency metadata so offline startup does not invoke npm for the default config directory.
DEFAULT_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
mkdir -p "$DEFAULT_CONFIG_DIR/node_modules"
if [ -f "$SCRIPT_DIR/config/package-lock.json" ]; then
  cp "$SCRIPT_DIR/config/package-lock.json" "$DEFAULT_CONFIG_DIR/"
fi
export OPENCODE_USER_ID_ENABLED="${OPENCODE_USER_ID_ENABLED:-true}"
export OPENCODE_ENABLE_TELEMETRY="${OPENCODE_ENABLE_TELEMETRY:-true}"
export OPENCODE_CAPTURE_CONTENT="${OPENCODE_CAPTURE_CONTENT:-true}"
export OPENCODE_CAPTURE_HTTP_HEADERS="${OPENCODE_CAPTURE_HTTP_HEADERS:-true}"
export OPENCODE_OTLP_ENDPOINT="${OPENCODE_OTLP_ENDPOINT:-http://localhost:4318}"
export OPENCODE_OTLP_PROTOCOL="${OPENCODE_OTLP_PROTOCOL:-http/json}"
export OPENCODE_DIFF_DETAIL_ENABLED="${OPENCODE_DIFF_DETAIL_ENABLED:-true}"
export PATH=$SCRIPT_DIR/bin:$PATH

# export ENTERPRISE_API_KEY=sk-your-key-here

exec $SCRIPT_DIR/bin/opencode "$@"
