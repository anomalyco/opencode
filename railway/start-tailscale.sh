#!/usr/bin/env bash
# Userspace networking: no /dev/net/tun or CAP_NET_ADMIN required (works on Railway).
set -uo pipefail

mkdir -p /data/tailscale /var/run/tailscale

if ! command -v tailscaled >/dev/null 2>&1; then
  echo "[tailscale] ERROR: tailscaled not on PATH; image build failed to install Tailscale" >&2
  exit 1
fi

echo "[tailscale] $(tailscale version 2>&1 | head -1)"
tailscaled --tun=userspace-networking --state=/data/tailscale/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock &
sleep 2

if [ -n "${TAILSCALE_AUTHKEY:-}" ]; then
  if tailscale up --authkey="$TAILSCALE_AUTHKEY" --hostname="${TAILSCALE_HOSTNAME:-opencode-veritly}" --accept-dns=false; then
    echo "[tailscale] joined tailnet"
  else
    echo "[tailscale] tailscale up failed (invalid or expired TAILSCALE_AUTHKEY?)" >&2
  fi
else
  echo "[tailscale] TAILSCALE_AUTHKEY unset — tailscaled running, node not joined (fine for local docker smoke test)"
fi

tailscale status 2>&1 || true
