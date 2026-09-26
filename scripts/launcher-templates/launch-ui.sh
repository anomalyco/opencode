#!/usr/bin/env bash
# launch-ui.sh — Open the opencode web UI in the vendored Catcheer
# browser.
#
# This launcher owns NOTHING:
#   * It never spawns, tracks, or kills the backend. The backend is supervised
#     by systemd (opencode-server.service), which is enabled and already
#     listening on 127.0.0.1:7700 before this launcher runs.
#   * It never stays resident: it does not block on the browser, poll for
#     liveness, or install an EXIT handler.
#   * It probes readiness, best-effort asks systemd to start the backend, opens
#     a detached browser window, and exits immediately. Closing the window has
#     no effect on the backend.
#
# URL hardening: only the 127.0.0.1 literal is ever handed to the browser.
# WebKit's HSTS preload upgrades http://localhost to https, which then fails
# against the plain-HTTP backend (the in-source override in gtk.cpp is
# commented out per upstream Catcheer).
#
# Installed by the deb at: /opt/opencode-ui/launch-ui.sh
#
# `disown` is a bash builtin and Debian's /bin/sh is dash, so this script keeps
# a bash shebang; the builtin is guarded for portability anyway.
set -euo pipefail

INSTALL_DIR="/opt/opencode-ui"
CATCHEER_BIN="$INSTALL_DIR/opencode-catcheer"
BACKEND_HOST="127.0.0.1"
BACKEND_PORT="7700"
HEALTH_PATH="/"
SERVICE_NAME="opencode-server.service"
# Bounded readiness budget (~30s). The backend is never spawned or terminated here.
READINESS_ATTEMPTS=30

UI_URL="http://${BACKEND_HOST}:${BACKEND_PORT}"
TITLE="OpenCode Web UI"

# Real HTTP readiness probe: bind(2) on the port happens before the HTTP loop
# can serve, so a bare TCP connect can race with "Connection refused".
http_ready() {
    command -v curl >/dev/null 2>&1 || return 1
    curl -fsS --max-time 2 -o /dev/null \
        "http://${BACKEND_HOST}:${BACKEND_PORT}${HEALTH_PATH}" 2>/dev/null
}

# Ensure the backend is up WITHOUT owning it. Best-effort start: if the call is
# denied (no privileges) we still poll, because the service may already be
# coming up or an admin may have started it. Never kill what we did not start.
if ! http_ready; then
    if [[ -n "$SERVICE_NAME" ]]; then
        echo "opencode backend not responding; requesting ${SERVICE_NAME} start..." >&2
        systemctl start "$SERVICE_NAME" >/dev/null 2>&1 || true
        attempt=0
        until http_ready; do
            attempt=$((attempt + 1))
            if [[ "$attempt" -ge "$READINESS_ATTEMPTS" ]]; then
                echo "ERROR: backend did not become ready within ${READINESS_ATTEMPTS}s." >&2
                echo "Inspect it with:" >&2
                echo "  systemctl status ${SERVICE_NAME}" >&2
                echo "  journalctl -u ${SERVICE_NAME} -n 50" >&2
                break
            fi
            sleep 1
        done
    else
        echo "WARNING: opencode backend not responding on ${UI_URL}${HEALTH_PATH}" >&2
        echo "         (no systemd unit configured — generated with --systemd no)" >&2
        echo "         Start the backend yourself; opening the browser anyway." >&2
    fi
fi

# Fall back to xdg-open when the bundled browser is missing (e.g. a dev host
# without gtk3/webkit2gtk-4.1 dev headers). The backend is still systemd's job.
if [[ ! -x "$CATCHEER_BIN" ]]; then
    echo "WARNING: bundled browser missing at $CATCHEER_BIN; using xdg-open" >&2
    if command -v xdg-open >/dev/null 2>&1; then
        exec xdg-open "$UI_URL"
    fi
    echo "Open $UI_URL in your browser"
    exit 0
fi

# URL hardening: localhost must become 127.0.0.1 to avoid the WebKit HSTS
# upgrade (the in-source override in gtk.cpp is commented out per upstream).
url="$(printf '%s' "$UI_URL" | sed -E 's#//localhost:#//127.0.0.1:#g')"

# Kill any stale Catcheer window from a previous launch (defence in depth:
# StartupWMClass should already group windows, but a SIGTERM here is cheap and
# avoids a duplicate window). This touches only the browser, never the backend.
pkill -f "${CATCHEER_BIN}.*--title ${TITLE}" 2>/dev/null || true

# Spawn the browser detached (setsid reparents it; disown detaches it from this
# shell's job table) so the window outlives this launcher. Then exit immediately
# — no EXIT handler, because the launcher owns nothing to release.
setsid "$CATCHEER_BIN" \
    --title "$TITLE" \
    --width 1280 --height 800 --resizable --border \
    --url "$url" \
    >/dev/null 2>&1 &
disown 2>/dev/null || true

exit 0
