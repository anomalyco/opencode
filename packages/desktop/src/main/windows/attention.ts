import type { BrowserWindow } from "electron"

export type AttentionWindow = Pick<BrowserWindow, "isDestroyed" | "isFocused" | "getNativeWindowHandle">

// FLASHWINFO on 64-bit Windows: cbSize at 0, the HWND at 8 after padding, then dwFlags, uCount and dwTimeout.
const FLASHWINFO_SIZE = 32

const FLASHW_TRAY = 2

const FLASH_COUNT = 2

// SHQueryUserNotificationState answers QUNS_ACCEPTS_NOTIFICATIONS when no Focus Assist rule, full-screen app,
// presentation or quiet hour holds notifications back.
const QUNS_ACCEPTS_NOTIFICATIONS = 5

/** A FLASHWINFO that flashes `hwnd`'s taskbar button twice and leaves it lit until the window comes forward. */
export function flashInfo(hwnd: Buffer) {
  const info = Buffer.alloc(FLASHWINFO_SIZE)
  info.writeUInt32LE(FLASHWINFO_SIZE, 0)
  hwnd.copy(info, 8, 0, 8)
  info.writeUInt32LE(FLASHW_TRAY, 16)
  info.writeUInt32LE(FLASH_COUNT, 20)

  return info
}

let native: Promise<Native | undefined> | undefined

type Native = {
  acceptsNotifications: () => boolean
  flash: (info: Buffer) => void
}

/**
 * Flashes a background window's taskbar button for a request that waits on the user: twice, then the button stays
 * lit until the window comes forward, as Windows apps do. Nothing flashes for a focused window, outside Windows, or
 * while Windows holds notifications back (Focus Assist, a full-screen app or a presentation).
 */
export async function requestAttention(win: AttentionWindow | null | undefined) {
  if (process.platform !== "win32" || !win || win.isDestroyed() || win.isFocused()) return
  native ??= loadNative().catch(() => undefined)
  const api = await native

  if (!api || win.isDestroyed() || win.isFocused() || !api.acceptsNotifications()) return
  api.flash(flashInfo(win.getNativeWindowHandle()))
}

async function loadNative(): Promise<Native> {
  const ffi = await import("ffi-rs")
  const t = ffi.DataType
  // Both are KnownDLLs loaded from System32; never a path from the environment.
  ffi.open({ library: "oc-attention-user32", path: "user32.dll" })
  ffi.open({ library: "oc-attention-shell32", path: "shell32.dll" })

  return {
    acceptsNotifications: () => {
      const state = Buffer.alloc(4)

      const hr = ffi.load({
        library: "oc-attention-shell32",
        funcName: "SHQueryUserNotificationState",
        retType: t.I32,
        paramsType: [t.U8Array],
        paramsValue: [state],
      })

      return hr >= 0 && state.readInt32LE(0) === QUNS_ACCEPTS_NOTIFICATIONS
    },
    flash: (info) => {
      ffi.load({
        library: "oc-attention-user32",
        funcName: "FlashWindowEx",
        retType: t.I32,
        paramsType: [t.U8Array],
        paramsValue: [info],
      })
    },
  }
}
