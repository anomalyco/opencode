#!/usr/bin/env python3
"""
macOS computer use helper for OpenCode.

Full operation set: screenshot, zoom, click, type, key, scroll, drag,
app management, clipboard, and permission checks.

Communicates via JSON on stdout: {ok, result} or {ok: false, error: {...}}

Usage: python3 mac_helper.py <command> --payload '<json>'
"""
from __future__ import annotations

import argparse
import base64
import ctypes
import json
import os
import subprocess
import sys
import time
from io import BytesIO
from pathlib import Path
from typing import Any

import mss
from AppKit import NSWorkspace, NSPasteboard, NSPasteboardTypeString, NSURL
from PIL import Image
from Quartz import (
    CGDisplayBounds,
    CGDisplayIsMain,
    CGDisplayModeGetPixelHeight,
    CGDisplayModeGetPixelWidth,
    CGDisplayPixelsHigh,
    CGDisplayPixelsWide,
    CGGetActiveDisplayList,
    CGMainDisplayID,
    CGPreflightScreenCaptureAccess,
    CGWindowListCopyWindowInfo,
    CGRectContainsPoint,
    CGRectIntersection,
    CGPointMake,
    kCGNullWindowID,
    kCGWindowIsOnscreen,
    kCGWindowLayer,
    kCGWindowListExcludeDesktopElements,
    kCGWindowListOptionOnScreenOnly,
    kCGWindowName,
    kCGWindowOwnerName,
    kCGWindowBounds,
)

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
os.environ.setdefault("PYAUTOGUI_HIDE_SUPPORT_PROMPT", "1")

import pyautogui  # noqa: E402

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0

# ── Key mapping ───────────────────────────────────────────────────────

KEY_MAP = {
    "a": "a", "b": "b", "c": "c", "d": "d", "e": "e", "f": "f",
    "g": "g", "h": "h", "i": "i", "j": "j", "k": "k", "l": "l",
    "m": "m", "n": "n", "o": "o", "p": "p", "q": "q", "r": "r",
    "s": "s", "t": "t", "u": "u", "v": "v", "w": "w", "x": "x",
    "y": "y", "z": "z",
    "0": "0", "1": "1", "2": "2", "3": "3", "4": "4",
    "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
    "cmd": "command", "command": "command", "meta": "command", "super": "command",
    "ctrl": "ctrl", "control": "ctrl",
    "shift": "shift",
    "alt": "option", "option": "option", "opt": "option",
    "fn": "fn",
    "escape": "esc", "esc": "esc",
    "enter": "enter", "return": "enter",
    "tab": "tab", "space": "space",
    "backspace": "backspace", "delete": "delete", "forwarddelete": "delete",
    "up": "up", "down": "down", "left": "left", "right": "right",
    "home": "home", "end": "end", "pageup": "pageup", "pagedown": "pagedown",
    "capslock": "capslock",
    "f1": "f1", "f2": "f2", "f3": "f3", "f4": "f4",
    "f5": "f5", "f6": "f6", "f7": "f7", "f8": "f8",
    "f9": "f9", "f10": "f10", "f11": "f11", "f12": "f12",
    "-": "minus", "=": "equals", "[": "[", "]": "]",
    "\\": "\\", ";": ";", "'": "'", ",": ",", ".": ".", "/": "/", "`": "`",
}


def normalize_key(name: str) -> str:
    key = name.strip().lower()
    if key not in KEY_MAP:
        raise ValueError(f"Unsupported key: {name}")
    return KEY_MAP[key]


# ── JSON output helpers ──────────────────────────────────────────────

def json_output(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def error_output(message: str, code: str = "runtime_error") -> None:
    json_output({"ok": False, "error": {"code": code, "message": message}})


# ── AppleScript helpers ──────────────────────────────────────────────

def run_osascript(script: str) -> str:
    result = subprocess.run(
        ["osascript", "-e", script], text=True, capture_output=True, check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "osascript failed")
    return result.stdout.strip()


def applescript_modifier(name: str) -> str:
    return {
        "command": "command down", "option": "option down",
        "shift": "shift down", "ctrl": "control down", "fn": "fn down",
    }[name]


def send_keystroke_via_osascript(character: str, modifiers: list[str] | None = None) -> None:
    escaped = character.replace("\\", "\\\\").replace('"', '\\"')
    if modifiers:
        mod_expr = ", ".join(applescript_modifier(m) for m in modifiers)
        script = f'tell application "System Events" to keystroke "{escaped}" using {{{mod_expr}}}'
    else:
        script = f'tell application "System Events" to keystroke "{escaped}"'
    run_osascript(script)


# ── Display management ───────────────────────────────────────────────

def get_displays() -> list[dict[str, Any]]:
    max_displays = 32
    err, active, count = CGGetActiveDisplayList(max_displays, None, None)
    if err != 0:
        raise RuntimeError(f"CGGetActiveDisplayList failed: {err}")
    displays: list[dict[str, Any]] = []
    main_id = CGMainDisplayID()
    for idx, display_id in enumerate(active[:count]):
        bounds = CGDisplayBounds(display_id)
        mode = None
        try:
            from Quartz import CGDisplayCopyDisplayMode
            mode = CGDisplayCopyDisplayMode(display_id)
        except Exception:
            mode = None
        physical_width = int(CGDisplayPixelsWide(display_id))
        physical_height = int(CGDisplayPixelsHigh(display_id))
        logical_width = int(bounds.size.width)
        logical_height = int(bounds.size.height)
        if mode is not None:
            mode_w = int(CGDisplayModeGetPixelWidth(mode))
            mode_h = int(CGDisplayModeGetPixelHeight(mode))
            physical_width = mode_w or physical_width
            physical_height = mode_h or physical_height
        scale_factor = physical_width / logical_width if logical_width else 1
        name = f"Display {idx + 1}"
        displays.append({
            "id": int(display_id), "displayId": int(display_id),
            "width": logical_width, "height": logical_height,
            "scaleFactor": scale_factor,
            "originX": int(bounds.origin.x), "originY": int(bounds.origin.y),
            "isPrimary": bool(display_id == main_id or CGDisplayIsMain(display_id)),
            "name": name, "label": name,
        })
    return displays


def choose_display(display_id: int | None) -> dict[str, Any]:
    displays = get_displays()
    if not displays:
        raise RuntimeError("No active displays found")
    if display_id is None:
        for d in displays:
            if d["isPrimary"]:
                return d
        return displays[0]
    for d in displays:
        if d["displayId"] == display_id or d["id"] == display_id:
            return d
    raise RuntimeError(f"Unknown display: {display_id}")


# ── Screen capture ───────────────────────────────────────────────────

def capture_display(display_id: int | None = None, resize: tuple[int, int] | None = None) -> dict[str, Any]:
    display = choose_display(display_id)
    monitor = {"left": display["originX"], "top": display["originY"],
               "width": display["width"], "height": display["height"]}
    with mss.mss() as sct:
        raw = sct.grab(monitor)
        image = Image.frombytes("RGB", raw.size, raw.rgb)
    if resize:
        image = image.resize(resize, Image.Resampling.LANCZOS)
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=75, optimize=True)
    return {
        "base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
        "width": image.width, "height": image.height,
        "displayWidth": display["width"], "displayHeight": display["height"],
        "displayId": display["displayId"],
        "originX": display["originX"], "originY": display["originY"],
    }


def capture_region(region: dict[str, int], resize: tuple[int, int] | None = None) -> dict[str, Any]:
    with mss.mss() as sct:
        raw = sct.grab(region)
        image = Image.frombytes("RGB", raw.size, raw.rgb)
    if resize:
        image = image.resize(resize, Image.Resampling.LANCZOS)
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=75, optimize=True)
    return {"base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
            "width": image.width, "height": image.height}


# ── Window / App management ──────────────────────────────────────────

def list_windows() -> list[dict[str, Any]]:
    windows = CGWindowListCopyWindowInfo(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID,
    )
    out: list[dict[str, Any]] = []
    for window in windows or []:
        if int(window.get(kCGWindowLayer, 0)) != 0:
            continue
        if not bool(window.get(kCGWindowIsOnscreen, True)):
            continue
        bounds = window.get(kCGWindowBounds) or {}
        w, h = int(bounds.get("Width", 0)), int(bounds.get("Height", 0))
        if w <= 1 or h <= 1:
            continue
        out.append({
            "ownerName": window.get(kCGWindowOwnerName, "") or "",
            "title": window.get(kCGWindowName, "") or "",
            "bounds": {"x": int(bounds.get("X", 0)), "y": int(bounds.get("Y", 0)),
                       "width": w, "height": h},
        })
    return out


def installed_apps() -> list[dict[str, Any]]:
    search_roots = [
        Path("/Applications"), Path.home() / "Applications",
        Path("/System/Applications"), Path("/System/Applications/Utilities"),
    ]
    results: dict[str, dict[str, Any]] = {}
    workspace = NSWorkspace.sharedWorkspace()
    for root in search_roots:
        if not root.exists():
            continue
        for app in root.rglob("*.app"):
            try:
                bundle = workspace.bundleIdentifierForURL_(NSURL.fileURLWithPath_(str(app)))
            except Exception:
                bundle = None
            info_plist = app / "Contents" / "Info.plist"
            display_name = app.stem
            if info_plist.exists():
                try:
                    import plistlib
                    with info_plist.open("rb") as f:
                        plist = plistlib.load(f)
                    bundle = bundle or plist.get("CFBundleIdentifier")
                    display_name = plist.get("CFBundleDisplayName") or plist.get("CFBundleName") or display_name
                except Exception:
                    pass
            if not bundle or bundle in results:
                continue
            results[bundle] = {"bundleId": str(bundle), "displayName": str(display_name), "path": str(app)}
    return sorted(results.values(), key=lambda x: x["displayName"].lower())


def running_apps() -> list[dict[str, Any]]:
    apps, seen = [], set()
    for app in NSWorkspace.sharedWorkspace().runningApplications() or []:
        bid = app.bundleIdentifier()
        if not bid or bid in seen:
            continue
        seen.add(bid)
        apps.append({"bundleId": str(bid), "displayName": str(app.localizedName() or bid)})
    return sorted(apps, key=lambda x: x["displayName"].lower())


def frontmost_app() -> dict[str, str] | None:
    app = NSWorkspace.sharedWorkspace().frontmostApplication()
    if not app or not app.bundleIdentifier():
        return None
    return {"bundleId": str(app.bundleIdentifier()), "displayName": str(app.localizedName() or app.bundleIdentifier())}


def open_app(bundle_id: str) -> None:
    url = NSWorkspace.sharedWorkspace().URLForApplicationWithBundleIdentifier_(bundle_id)
    if not url:
        raise RuntimeError(f"App not found: {bundle_id}")
    ok, err = NSWorkspace.sharedWorkspace().launchApplicationAtURL_options_configuration_error_(url, 0, {}, None)
    if not ok:
        raise RuntimeError(str(err) if err else f"Failed to open {bundle_id}")


# ── Clipboard ────────────────────────────────────────────────────────

def read_clipboard() -> str:
    pb = NSPasteboard.generalPasteboard()
    value = pb.stringForType_(NSPasteboardTypeString)
    return "" if value is None else str(value)


def write_clipboard(text: str) -> None:
    pb = NSPasteboard.generalPasteboard()
    pb.clearContents()
    pb.setString_forType_(text, NSPasteboardTypeString)


def paste_clipboard() -> None:
    send_keystroke_via_osascript("v", ["command"])


# ── Input: Mouse ─────────────────────────────────────────────────────

def click(x: int, y: int, button: str, count: int, modifiers: list[str] | None) -> None:
    pyautogui.moveTo(x, y)
    if modifiers:
        normalized = [normalize_key(m) for m in modifiers]
        for key in normalized:
            pyautogui.keyDown(key)
        try:
            pyautogui.click(x=x, y=y, button=button, clicks=count, interval=0.08)
        finally:
            for key in reversed(normalized):
                pyautogui.keyUp(key)
    else:
        pyautogui.click(x=x, y=y, button=button, clicks=count, interval=0.08)


def scroll(x: int, y: int, delta_x: int, delta_y: int) -> None:
    pyautogui.moveTo(x, y)
    if delta_y:
        pyautogui.scroll(int(delta_y), x=x, y=y)
    if delta_x:
        pyautogui.hscroll(int(delta_x), x=x, y=y)


def drag(from_point: dict | None, to: dict) -> None:
    if from_point:
        pyautogui.moveTo(int(from_point["x"]), int(from_point["y"]))
    pyautogui.dragTo(int(to["x"]), int(to["y"]), duration=0.2, button="left")


def move_mouse(x: int, y: int) -> None:
    pyautogui.moveTo(x, y)


# ── Input: Keyboard ──────────────────────────────────────────────────

def key_action(sequence: str, repeat: int = 1) -> None:
    parts = [normalize_key(p) for p in sequence.split("+") if p.strip()]
    for _ in range(max(1, repeat)):
        if parts == ["command", "v"]:
            paste_clipboard()
        elif parts == ["command", "a"]:
            send_keystroke_via_osascript("a", ["command"])
        elif parts == ["command", "c"]:
            send_keystroke_via_osascript("c", ["command"])
        elif parts == ["command", "x"]:
            send_keystroke_via_osascript("x", ["command"])
        elif len(parts) == 1:
            pyautogui.press(parts[0])
        else:
            pyautogui.hotkey(*parts, interval=0.02)
        time.sleep(0.01)


def hold_keys(keys: list[str], duration_ms: int) -> None:
    normalized = [normalize_key(k) for k in keys]
    for key in normalized:
        pyautogui.keyDown(key)
    try:
        time.sleep(max(duration_ms, 0) / 1000)
    finally:
        for key in reversed(normalized):
            pyautogui.keyUp(key)


def type_text(text: str) -> None:
    pyautogui.write(text, interval=0.008)


def type_via_clipboard(text: str) -> None:
    saved = read_clipboard()
    try:
        write_clipboard(text)
        time.sleep(0.04)
        paste_clipboard()
        time.sleep(0.18)
    finally:
        write_clipboard(saved)


# ── Permission checks ────────────────────────────────────────────────

def detect_screen_recording_permission() -> bool | None:
    try:
        if CGPreflightScreenCaptureAccess():
            return True
    except Exception:
        pass
    try:
        windows = CGWindowListCopyWindowInfo(
            kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID,
        )
    except Exception:
        return None
    eligible = 0
    for window in windows or []:
        if int(window.get(kCGWindowLayer, 0)) != 0:
            continue
        if not bool(window.get(kCGWindowIsOnscreen, True)):
            continue
        bounds = window.get(kCGWindowBounds) or {}
        if int(bounds.get("Width", 0)) <= 1 or int(bounds.get("Height", 0)) <= 1:
            continue
        eligible += 1
        if (window.get(kCGWindowName, "") or "").strip():
            return True
    return False if eligible > 0 else None


def detect_accessibility_permission() -> bool:
    try:
        lib = ctypes.CDLL("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices")
        lib.AXIsProcessTrusted.restype = ctypes.c_bool
        lib.AXIsProcessTrusted.argtypes = []
        return bool(lib.AXIsProcessTrusted())
    except Exception:
        return False


def check_permissions() -> dict[str, bool | None]:
    return {
        "accessibility": detect_accessibility_permission(),
        "screenRecording": detect_screen_recording_permission(),
    }


# ── Command dispatcher ───────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="OpenCode Computer Use Helper")
    parser.add_argument("command")
    parser.add_argument("--payload", default="{}")
    args = parser.parse_args()
    payload = json.loads(args.payload)

    try:
        cmd = args.command

        # Permissions
        if cmd == "check_permissions":
            json_output({"ok": True, "result": check_permissions()})
        # Display
        elif cmd == "list_displays":
            json_output({"ok": True, "result": get_displays()})
        # Screenshot
        elif cmd == "screenshot":
            resize = None
            if payload.get("targetWidth") and payload.get("targetHeight"):
                resize = (int(payload["targetWidth"]), int(payload["targetHeight"]))
            json_output({"ok": True, "result": capture_display(payload.get("displayId"), resize)})
        elif cmd == "zoom":
            resize = None
            if payload.get("targetWidth") and payload.get("targetHeight"):
                resize = (int(payload["targetWidth"]), int(payload["targetHeight"]))
            region = {"left": int(payload["x"]), "top": int(payload["y"]),
                      "width": int(payload["width"]), "height": int(payload["height"])}
            json_output({"ok": True, "result": capture_region(region, resize)})
        # Mouse
        elif cmd == "click":
            click(int(payload["x"]), int(payload["y"]),
                  str(payload.get("button") or "left"),
                  int(payload.get("count") or 1),
                  payload.get("modifiers"))
            json_output({"ok": True, "result": True})
        elif cmd == "scroll":
            scroll(int(payload["x"]), int(payload["y"]),
                   int(payload.get("deltaX") or 0), int(payload.get("deltaY") or 0))
            json_output({"ok": True, "result": True})
        elif cmd == "drag":
            drag(payload.get("from"), payload["to"])
            json_output({"ok": True, "result": True})
        elif cmd == "move_mouse":
            move_mouse(int(payload["x"]), int(payload["y"]))
            json_output({"ok": True, "result": True})
        # Keyboard
        elif cmd == "key":
            key_action(str(payload["keySequence"]), int(payload.get("repeat") or 1))
            json_output({"ok": True, "result": True})
        elif cmd == "hold_key":
            hold_keys(list(payload.get("keyNames") or []), int(payload.get("durationMs") or 0))
            json_output({"ok": True, "result": True})
        elif cmd == "type":
            type_text(str(payload.get("text") or ""))
            json_output({"ok": True, "result": True})
        elif cmd == "type_via_clipboard":
            type_via_clipboard(str(payload.get("text") or ""))
            json_output({"ok": True, "result": True})
        # App management
        elif cmd == "frontmost_app":
            json_output({"ok": True, "result": frontmost_app()})
        elif cmd == "list_installed_apps":
            json_output({"ok": True, "result": installed_apps()})
        elif cmd == "list_running_apps":
            json_output({"ok": True, "result": running_apps()})
        elif cmd == "open_app":
            open_app(str(payload["bundleId"]))
            json_output({"ok": True, "result": True})
        # Clipboard
        elif cmd == "read_clipboard":
            json_output({"ok": True, "result": read_clipboard()})
        elif cmd == "write_clipboard":
            write_clipboard(str(payload.get("text") or ""))
            json_output({"ok": True, "result": True})
        else:
            error_output(f"Unknown command: {cmd}", code="bad_command")
            return 2
        return 0

    except Exception as exc:
        error_output(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
