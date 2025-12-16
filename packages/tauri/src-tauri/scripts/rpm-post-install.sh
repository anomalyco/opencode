#!/bin/bash
# Post-install script for OpenCode RPM package
# Modifies the .desktop file to set Wayland environment variables

set -e

DESKTOP_FILE="/usr/share/applications/OpenCode.desktop"

# Update the desktop file's Exec line to set Wayland environment variables
if [ -f "$DESKTOP_FILE" ]; then
  sed -i 's|^Exec=.*|Exec=env WEBKIT_DISABLE_DMABUF_RENDERER=1 GDK_BACKEND=wayland /opt/opencode/bin/opencode %u|' "$DESKTOP_FILE"
fi

# Update desktop database (required for .desktop file changes)
if command -v update-desktop-database &> /dev/null; then
  update-desktop-database /usr/share/applications/ || true
fi

exit 0
