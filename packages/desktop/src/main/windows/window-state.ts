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

// Bounds are only trusted when they still fit on one of the current displays; otherwise the window
// falls back to the default size, capped to the matched display and placed at its global origin.
// A saved maximized or fullscreen state is kept even when bounds are missing or rejected so
// manageWindowState() can restore it.
export function resolveWindowState(saved: unknown, defaults: { width: number; height: number }, displays: Displays) {
  const state = isState(saved) ? saved : undefined

  if (!state) return { width: defaults.width, height: defaults.height } satisfies WindowState

  if (!hasBounds(state)) {
    return state.isMaximized || state.isFullScreen
      ? ({ ...state, width: defaults.width, height: defaults.height } satisfies WindowState)
      : ({ width: defaults.width, height: defaults.height } satisfies WindowState)
  }

  if (!state.displayBounds) return state
  const visible = displays.all().some((bounds) => within(state, bounds))

  if (visible) return state

  const matched = displays.matching({ x: state.x, y: state.y, width: state.width, height: state.height })

  const display = displays.all().find((bounds) => sameBounds(bounds, matched)) ?? displays.primary()

  return {
    width: Math.min(defaults.width, display.width),
    height: Math.min(defaults.height, display.height),
    x: display.x,
    y: display.y,
    displayBounds: display,
    isMaximized: state.isMaximized,
    isFullScreen: state.isFullScreen,
  } satisfies WindowState
}

export function windowStateFile(id: string) {
  return `window-state-${id.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`
}

export function readWindowState(file: string): unknown {
  if (!existsSync(file)) return undefined

  try {
    return JSON.parse(readFileSync(file, "utf8"))
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

function isState(value: unknown): value is WindowState {
  return typeof value === "object" && value !== null
}

function hasBounds(state: WindowState): state is WindowState & Required<Pick<WindowState, "x" | "y">> {
  return (
    Number.isInteger(state.x) &&
    Number.isInteger(state.y) &&
    Number.isInteger(state.width) &&
    state.width > 0 &&
    Number.isInteger(state.height) &&
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
