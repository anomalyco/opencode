#!/usr/bin/env bash
# Baseline shell script: variables, quoting, conditionals.
set -euo pipefail

ENVIRONMENT="${1:-staging}"
REGION="us-east-1"
RETRIES=3

log() {
  echo "[deploy] $*"
}

if [[ "$ENVIRONMENT" == "production" ]]; then
  log "Deploying to production in $REGION"
else
  log "Deploying to $ENVIRONMENT"
fi

for attempt in $(seq 1 "$RETRIES"); do
  log "Attempt $attempt of $RETRIES"
done
