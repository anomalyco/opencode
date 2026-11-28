import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Option, Schema } from "effect"
import type { BrowserWindow, Rectangle } from "electron"

// Remembers a window's bounds and maximized / fullscreen flags across launches in the same JSON
// file electron-window-state wrote, so existing profiles restore where they were.

export type WindowState = {
  x?: number
  y?: number
  width: number
  height: number
  displayBounds?: Rectangle
  isMaximized?: boolean
  isFullScreen?: boolean
}

export type Displays = {
  all: () => Rectangle[]
  primary: () => Rectangle
  matching: (bounds: Rectangle) => Rectangle
}

const StateFile = Schema.fromJsonString(
  Schema.Struct({
    x: Schema.optional(Schema.Int),
    y: Schema.optional(Schema.Int),
    width: Schema.optional(Schema.Int),
    height: Schema.optional(Schema.Int),
    displayBounds: Schema.optional(
      Schema.Struct({ x: Schema.Int, y: Schema.Int, width: Schema.Int, height: Schema.Int }),
    ),
    isMaximized: Schema.optional(Schema.Boolean),
    isFullScreen: Schema.optional(Schema.Boolean),
  }),
)

// Bounds are only trusted when they still fit on one of the current displays; otherwise the window
// falls back to the default size on the primary display. A saved maximized or fullscreen state is
// kept in every fallback so manage() can restore it.
export function resolveWindowState(
  saved: Partial<WindowState> | undefined,
  defaults: { width: number; height: number },
  displays: Displays,
): WindowState {
  if (!saved) return { width: defaults.width, height: defaults.height }

  if (!hasBounds(saved)) {
    return saved.isMaximized || saved.isFullScreen
      ? { ...saved, width: defaults.width, height: defaults.height }
      : { width: defaults.width, height: defaults.height }
  }

  const savedDisplay = saved.displayBounds

  if (!savedDisplay) return saved
  const all = displays.all()

  // Normal bounds are only recorded while the window is restored, so a window maximized on another
  // display keeps x/y on the display it was restored on. maximize() uses the display under the normal
  // bounds, so move them onto the saved display while it is still connected.
  const target =
    saved.isMaximized || saved.isFullScreen ? all.find((bounds) => sameBounds(bounds, savedDisplay)) : undefined

  if (target && !within(saved, target)) {
    const width = Math.min(saved.width, target.width)
    const height = Math.min(saved.height, target.height)

    return {
      ...saved,
      x: target.x + Math.floor((target.width - width) / 2),
      y: target.y + Math.floor((target.height - height) / 2),
      width,
      height,
    }
  }

  // Windows counts a window's invisible resize borders in its bounds, so a window snapped to a display's edge hangs
  // about 7px off it at 100% scale and more at higher scales.
  const slack = process.platform === "win32" ? 16 : 0

  if (all.some((bounds) => within(saved, bounds, slack))) return saved
  const primary = displays.primary()

  return {
    width: defaults.width,
    height: defaults.height,
    x: primary.x,
    y: primary.y,
    displayBounds: primary,
    isMaximized: saved.isMaximized,
    isFullScreen: saved.isFullScreen,
  }
}

export function windowStateFile(id: string) {
  return `window-state-${id.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`
}

export function readWindowState(file: string) {
  if (!existsSync(file)) return undefined

  return Option.getOrUndefined(Schema.decodeUnknownOption(StateFile)(readFileSync(file, "utf8")))
}

type ManagedEvent = "resize" | "move" | "close" | "closed"

export type ManagedWindow = Pick<
  BrowserWindow,
  | "maximize"
  | "setFullScreen"
  | "isDestroyed"
  | "isMaximized"
  | "isMinimized"
  | "isFullScreen"
  | "getBounds"
  | "getNormalBounds"
> & {
  on(event: ManagedEvent, listener: () => void): void
  off(event: ManagedEvent, listener: () => void): void
}

// Tracks the window until it closes and writes the final state then. Bounds are recorded while
// the window is in its normal state so a maximized window restores to its previous size.
export function manageWindowState(win: ManagedWindow, file: string, initial: WindowState, displays: Displays) {
  // On Windows, a frameless titleBarOverlay window has no caption buttons in fullscreen, so never boot into it.
  const state =
    process.platform === "win32" && initial.isFullScreen ? { ...initial, isFullScreen: false } : { ...initial }

  if (state.isMaximized) win.maximize()

  if (state.isFullScreen) win.setFullScreen(true)
  let timer: ReturnType<typeof setTimeout> | undefined

  const update = () => {
    if (win.isDestroyed()) return

    // A minimized window on Windows reports no maximized state and a frame at -32000, so it keeps how it was shown.
    if (process.platform === "win32" && win.isMinimized()) return
    const bounds = win.getBounds()

    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) {
      state.x = bounds.x
      state.y = bounds.y
      state.width = bounds.width
      state.height = bounds.height
    }

    // Windows keeps the frame a maximized window restores to and moves it with the window (Win+Shift+Arrow), which
    // the bounds read while restored can never see.
    if (process.platform === "win32" && win.isMaximized() && !win.isFullScreen()) {
      const normal = win.getNormalBounds()
      state.x = normal.x
      state.y = normal.y
      state.width = normal.width
      state.height = normal.height
    }

    state.isMaximized = win.isMaximized()
    state.isFullScreen = process.platform === "win32" ? false : win.isFullScreen()
    state.displayBounds = displays.matching(bounds)
  }

  const changed = () => {
    clearTimeout(timer)
    timer = setTimeout(update, 100)
  }

  const closed = () => {
    clearTimeout(timer)
    win.off("resize", changed)
    win.off("move", changed)
    win.off("close", update)
    win.off("closed", closed)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(state))
    renameSync(`${file}.tmp`, file)
  }

  win.on("resize", changed)
  win.on("move", changed)
  win.on("close", update)
  win.on("closed", closed)
}

function hasBounds(state: Partial<WindowState>): state is WindowState & Required<Pick<WindowState, "x" | "y">> {
  return state.x !== undefined && state.y !== undefined && (state.width ?? 0) > 0 && (state.height ?? 0) > 0
}

function within(state: WindowState & { x: number; y: number }, bounds: Rectangle, slack = 0) {
  return (
    state.x >= bounds.x - slack &&
    state.y >= bounds.y - slack &&
    state.x + state.width <= bounds.x + bounds.width + slack &&
    state.y + state.height <= bounds.y + bounds.height + slack
  )
}

function sameBounds(a: Rectangle, b: Rectangle) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
