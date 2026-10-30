import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
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

type RawWindowState = {
  readonly x?: unknown
  readonly y?: unknown
  readonly width?: unknown
  readonly height?: unknown
  readonly displayBounds?: unknown
  readonly isMaximized?: unknown
  readonly isFullScreen?: unknown
}

// Bounds are only trusted when they still fit on one of the current displays; otherwise the window
// falls back to the default size on the primary display. A saved maximized or fullscreen state
// without bounds is kept so manage() can restore it.
export function resolveWindowState(
  saved: Partial<WindowState> | undefined,
  defaults: { width: number; height: number },
  displays: Displays,
): WindowState {
  if (!saved) return { width: defaults.width, height: defaults.height }

  if (!hasBounds(saved)) {
    const fallback: WindowState = { width: defaults.width, height: defaults.height }

    if (saved.isMaximized !== undefined) fallback.isMaximized = saved.isMaximized

    if (saved.isFullScreen !== undefined) fallback.isFullScreen = saved.isFullScreen

    return fallback
  }

  if (!saved.displayBounds) return saved
  const all = displays.all()
  const savedDisplay = isRectangle(saved.displayBounds) ? saved.displayBounds : undefined

  // Maximizing after moving across monitors updates `displayBounds` while keeping the last normal `x`/`y`
  // on the original display. Re-anchor into `displayBounds` when that monitor is still connected so
  // `win.maximize()` maximizes on the monitor where the window was closed, including negative coordinates.
  const target =
    (saved.isMaximized || saved.isFullScreen) && savedDisplay
      ? all.find((bounds) => sameBounds(bounds, savedDisplay))
      : undefined

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

  const visible = all.some((bounds) => within(saved, bounds))

  if (visible) return saved
  const primary = displays.primary()

  const fallback: WindowState = {
    width: defaults.width,
    height: defaults.height,
    x: primary.x,
    y: primary.y,
    displayBounds: primary,
  }

  if (saved.isMaximized) fallback.isMaximized = true

  if (saved.isFullScreen) fallback.isFullScreen = true

  return fallback
}

export function windowStateFile(id: string) {
  return `window-state-${id.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`
}

export function readWindowState(file: string): Partial<WindowState> | undefined {
  if (!existsSync(file)) return undefined

  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))

    if (!isRawState(parsed)) return undefined
    const result: Partial<WindowState> = {}

    if (isInteger(parsed.x)) result.x = parsed.x

    if (isInteger(parsed.y)) result.y = parsed.y

    if (isInteger(parsed.width)) result.width = parsed.width

    if (isInteger(parsed.height)) result.height = parsed.height

    if (isRectangle(parsed.displayBounds)) {
      result.displayBounds = {
        x: parsed.displayBounds.x,
        y: parsed.displayBounds.y,
        width: parsed.displayBounds.width,
        height: parsed.displayBounds.height,
      }
    }

    if (isBoolean(parsed.isMaximized)) result.isMaximized = parsed.isMaximized

    if (isBoolean(parsed.isFullScreen)) result.isFullScreen = parsed.isFullScreen

    return result
  } catch {
    return undefined
  }
}

// Tracks the window until it closes and writes the final state then. Bounds are recorded while
// the window is in its normal state so a maximized window restores to its previous size.
export function manageWindowState(win: BrowserWindow, file: string, initial: WindowState, displays: Displays) {
  const state = { ...initial }

  if (state.isMaximized) win.maximize()

  if (state.isFullScreen) win.setFullScreen(true)
  let timer: ReturnType<typeof setTimeout> | undefined

  const update = () => {
    if (win.isDestroyed()) return
    const bounds = win.getBounds()

    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) {
      state.x = bounds.x
      state.y = bounds.y
      state.width = bounds.width
      state.height = bounds.height
    }

    state.isMaximized = win.isMaximized()
    state.isFullScreen = win.isFullScreen()
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

function isRawState(value: unknown): value is RawWindowState {
  return Boolean(value) && Object(value) === value && !Array.isArray(value)
}

function isInteger(value: unknown): value is number {
  return Number.isInteger(value)
}

function isBoolean(value: unknown): value is boolean {
  return value === true || value === false
}

function isRectangle(value: unknown): value is Rectangle {
  if (!isRawState(value)) return false

  return (
    isInteger(value.x) &&
    isInteger(value.y) &&
    isInteger(value.width) &&
    value.width > 0 &&
    isInteger(value.height) &&
    value.height > 0
  )
}

function hasBounds(state: Partial<WindowState>): state is WindowState & Required<Pick<WindowState, "x" | "y">> {
  return (
    isInteger(state.x) &&
    isInteger(state.y) &&
    isInteger(state.width) &&
    state.width > 0 &&
    isInteger(state.height) &&
    state.height > 0
  )
}

function within(state: WindowState & { x: number; y: number }, bounds: Rectangle) {
  return (
    state.x >= bounds.x &&
    state.y >= bounds.y &&
    state.x + state.width <= bounds.x + bounds.width &&
    state.y + state.height <= bounds.y + bounds.height
  )
}

function sameBounds(a: Rectangle, b: Rectangle) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
