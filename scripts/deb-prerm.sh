#!/bin/bash
set -e

case "$1" in
  remove|upgrade|deconfigure)
    if command -v systemctl >/dev/null 2>&1; then
      systemctl stop opencode-server.service 2>/dev/null || true
      systemctl disable opencode-server.service 2>/dev/null || true
      systemctl daemon-reload 2>/dev/null || true
    fi
    ;;
esac

exit 0
