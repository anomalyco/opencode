#!/bin/bash
SCRIPT_DIR=$(cd $(dirname $0) && pwd)
export OPENCODE_CONFIG_DIR=$SCRIPT_DIR/config
export OPENCODE_PARSERS_DIR=$SCRIPT_DIR/parsers
export OPENCODE_DISABLE_AUTOUPDATE=true
export OPENCODE_DISABLE_MODELS_FETCH=true
export OPENCODE_DISABLE_LSP_DOWNLOAD=true
export PATH=$SCRIPT_DIR/bin:$PATH

exec $SCRIPT_DIR/bin/opencode "$@"
