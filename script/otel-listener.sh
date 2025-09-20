#!/usr/bin/env bash

# Fail at the first sign of trouble
set -euo pipefail

prettyPrintScript="$(dirname "$0")/otel-pretty-printer.jq"

# Preflight: ensure required tools are available
for tool in otel-cli jq; do
    if ! command -v "${tool}" >/dev/null 2>&1; then
        echo "error: $0: required tool '${tool}' not found in PATH. Install '${tool}' and try again." 1>&2
        exit 1
    fi
done

if ! command -v "${prettyPrintScript}">/dev/null; then
    echo "error: $0: ${prettyPrintScript} does not exist or is not marked executable" 2>&1
    exit 1
fi

otel-cli server json --verbose --fail --stdout | "${prettyPrintScript}"
