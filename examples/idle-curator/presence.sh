#!/bin/bash
# presence.sh — minimal OS idle probe (Linux). Order: Mutter -> KDE -> xprintidle -> unknown.
# Output: single-line JSON {"os_idle_ms":N,"source":"...","session_type":"...","desktop":"..."}
# os_idle_ms: ms since last input, -1 = unknown. No deps beyond systemd/dbus on GNOME/KDE.
set -u
SRC="unknown"
IDLE="-1"
STYPE="${XDG_SESSION_TYPE:-unknown}"
DESK="${XDG_CURRENT_DESKTOP:-unknown}"

pick_num() { grep -o '[0-9]\+' | tail -n1; }

# 1. GNOME Mutter (X11 + Wayland canonical path)
if [ "$IDLE" = "-1" ] && command -v busctl >/dev/null 2>&1; then
  OUT=$(timeout 2 busctl --user call org.gnome.Mutter.IdleMonitor /org/gnome/Mutter/IdleMonitor/Core org.gnome.Mutter.IdleMonitor GetIdletime 2>/dev/null)
  if [ -n "$OUT" ]; then
    NUM=$(echo "$OUT" | pick_num)
    if [ -n "$NUM" ]; then IDLE="$NUM"; SRC="mutter"; fi
  fi
fi

# 2. KDE / freedesktop ScreenSaver (ms on KDE by design, do NOT divide)
if [ "$IDLE" = "-1" ]; then
  if command -v qdbus >/dev/null 2>&1; then
    for SVC in org.freedesktop.ScreenSaver org.kde.screensaver; do
      OUT=$(timeout 2 qdbus "$SVC" /ScreenSaver GetSessionIdleTime 2>/dev/null)
      NUM=$(echo "$OUT" | pick_num)
      if [ -n "$NUM" ]; then IDLE="$NUM"; SRC="screensaver:$SVC"; break; fi
    done
  fi
  if [ "$IDLE" = "-1" ] && command -v busctl >/dev/null 2>&1; then
    OUT=$(timeout 2 busctl --user call org.freedesktop.ScreenSaver /ScreenSaver org.freedesktop.ScreenSaver GetSessionIdleTime 2>/dev/null)
    NUM=$(echo "$OUT" | pick_num)
    if [ -n "$NUM" ]; then IDLE="$NUM"; SRC="screensaver:busctl"; fi
  fi
fi

# 3. X11 fallback (XSS extension; XWayland input only)
if [ "$IDLE" = "-1" ] && [ "$STYPE" = "x11" ] && command -v xprintidle >/dev/null 2>&1; then
  OUT=$(timeout 2 xprintidle 2>/dev/null)
  NUM=$(echo "$OUT" | pick_num)
  if [ -n "$NUM" ]; then IDLE="$NUM"; SRC="xprintidle"; fi
fi

printf '{"os_idle_ms":%s,"source":"%s","session_type":"%s","desktop":"%s"}\n' "$IDLE" "$SRC" "$STYPE" "$DESK"
