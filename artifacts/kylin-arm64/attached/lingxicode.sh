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
export OPENCODE_DISABLE_TELEMETRY=true
export OMO_DISABLE_POSTHOG=1
export OPENCODE_SCAN_DIR_PLUGINS=0
export PATH=$SCRIPT_DIR/bin:$PATH

# export ENTERPRISE_API_KEY=sk-your-key-here

exec $SCRIPT_DIR/bin/opencode "$@"