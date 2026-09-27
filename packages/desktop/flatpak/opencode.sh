#!/bin/sh
# Launcher for the OpenCode desktop Flatpak.
#
# `zypak-wrapper` (provided by org.electronjs.Electron2.BaseApp) sets up the
# Chromium sandbox correctly inside the Flatpak sandbox before exec'ing the
# Electron binary.
set -eu

export TMPDIR="${XDG_RUNTIME_DIR}/app/${FLATPAK_ID}"

exec zypak-wrapper /app/opencode/ai.opencode.desktop "$@"