#!/usr/bin/env bash
# Deploy voice staging — all three apps on Fly.io.
#
# Prerequisites:
#   flyctl auth login
#   fly apps create opencode-voice-server
#   fly apps create opencode-voice-sidecar
#   fly apps create opencode-voice-ui
#   fly volumes create tenants --size 10 --region iad -a opencode-voice-server
#
# Secrets (once per app):
#   fly secrets set OPENCODE_SERVER_PASSWORD=… XAI_API_KEY=… -a opencode-voice-server
#   fly secrets set XAI_API_KEY=… OPENCODE_SERVER_PASSWORD=… VOICE_SIDECAR_TOKEN=… \
#     OPENCODE_SERVER_URL=https://opencode-voice-server.fly.dev \
#     VOICE_CORS_ORIGINS=https://opencode-voice-ui.fly.dev \
#     -a opencode-voice-sidecar
#
# Usage:
#   ./scripts/deploy-voice-staging.sh          # server + sidecar + ui
#   ./scripts/deploy-voice-staging.sh server
#   ./scripts/deploy-voice-staging.sh sidecar
#   ./scripts/deploy-voice-staging.sh ui

set -euo pipefail

if ! command -v fly >/dev/null 2>&1; then
  echo "error: fly not found. Install flyctl:" >&2
  echo "  curl -L https://fly.io/install.sh | sh" >&2
  echo "  export PATH=\"\$HOME/.fly/bin:\$PATH\"" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-all}"

deploy_server() {
  echo "==> Deploying opencode server to Fly..."
  fly deploy "$ROOT" \
    --config "$ROOT/packages/opencode/fly.toml" \
    --dockerfile packages/opencode/Dockerfile.server
  echo "    Health: https://opencode-voice-server.fly.dev/global/health"
}

deploy_sidecar() {
  echo "==> Deploying voice sidecar to Fly..."
  fly deploy "$ROOT/packages/voice-sidecar" --config "$ROOT/packages/voice-sidecar/fly.toml"
  echo "    Health: https://opencode-voice-sidecar.fly.dev/health"
}

deploy_ui() {
  echo "==> Deploying web UI to Fly..."
  fly deploy "$ROOT" \
    --config "$ROOT/packages/app/fly.toml" \
    --dockerfile packages/app/Dockerfile
  echo "    App: https://opencode-voice-ui.fly.dev"
}

case "$TARGET" in
  server) deploy_server ;;
  sidecar) deploy_sidecar ;;
  ui) deploy_ui ;;
  all)
    deploy_server
    deploy_sidecar
    deploy_ui
    ;;
  *)
    echo "usage: $0 [server|sidecar|ui|all]" >&2
    exit 1
    ;;
esac

echo "==> Done."
echo "    UI:     https://opencode-voice-ui.fly.dev"
echo "    Server: https://opencode-voice-server.fly.dev"
echo "    Voice:  https://opencode-voice-sidecar.fly.dev"
