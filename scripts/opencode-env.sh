#!/usr/bin/env bash
# Wrapper: source user's bashrc (which loads API keys from KeePassXC via
# common_bashrc → kpx_get), then exec opencode serve.
#
# common_bashrc has  [ -z "$PS1" ] && return  which short-circuits in
# non-interactive shells.  Setting PS1 before sourcing bypasses that guard
# so the env-loading loop at the bottom of common_bashrc actually runs.

# D-Bus session required for kpx_get (KeePassXC browser integration)
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/1000/bus}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-/home/mxadm/.Xauthority}"

export PS1="(opencode-env) "
source /home/mxadm/.bashrc 2>/dev/null || true
unset PS1

# Optional: log which keys loaded (appears in journal)
echo "opencode-env: NVIDIA=${NVIDIA_API_KEY:+ok} OPENROUTER=${OPENROUTER_API_KEY:+ok} OMN=${OMN_API_KEY:+ok}" >&2

exec /usr/bin/opencode "$@"
