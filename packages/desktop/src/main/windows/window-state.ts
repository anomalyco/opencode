import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { BrowserWindow, Rectangle } from "electron"
import { Option, Schema } from "effect"

// Remembers a window's bounds and maximized / fullscreen flags across launches in the same JSON
// file electron-window-state wrote, so existing profiles restore where they were.

const Bounds = Schema.Struct({
  x: Schema.Int,
  y: Schema.Int,
  width: Schema.Int,
  height: Schema.Int,
})

const SavedWindowState = Schema.Struct({
  x: Schema.optional(Schema.Int),
  y: Schema.optional(Schema.Int),
  width: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  height: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  displayBounds: Schema.optional(Bounds),
  isMaximized: Schema.optional(Schema.Boolean),
  isFullScreen: Schema.optional(Schema.Boolean),
})

const SavedWindowFlags = Schema.Struct({
  isMaximized: Schema.optional(Schema.Boolean),
  isFullScreen: Schema.optional(Schema.Boolean),
})

export type SavedWindowState = typeof SavedWindowState.Type

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
// falls back to the default size on the primary display. A saved maximized or fullscreen state
// without bounds is kept so manage() can restore it.
export function resolveWindowState(saved: SavedWindowState | undefined, defaults: { width: number; height: number }, displays: Displays) {
  if (!saved) return { width: defaults.width, height: defaults.height } satisfies WindowState

  if (!hasBounds(saved)) {
    return saved.isMaximized || saved.isFullScreen
      ? ({ ...saved, width: defaults.width, height: defaults.height } satisfies WindowState)
      : ({ width: defaults.width, height: defaults.height } satisfies WindowState)
  }

  if (!saved.displayBounds) return saved
  const visible = displays.all().some((bounds) => within(saved, bounds))

  if (visible) return saved

  return {
    width: defaults.width,
    height: defaults.height,
    x: 0,
    y: 0,
    displayBounds: displays.primary(),
  } satisfies WindowState
}

export function windowStateFile(id: string) {
  return `window-state-${id.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`
}

const decodeWindowState = Schema.decodeUnknownOption(Schema.fromJsonString(SavedWindowState))

const decodeWindowFlags = Schema.decodeUnknownOption(Schema.fromJsonString(SavedWindowFlags))

export function readWindowState(file: string): SavedWindowState | undefined {
  if (!existsSync(file)) return undefined

  try {
    const contents = readFileSync(file, "utf8")
    const state = Option.getOrUndefined(decodeWindowState(contents))

    if (state) return state

    // Keep the flags when only the bounds are unusable; resolveWindowState already falls back
    // to the default size for those, and the window should still restore maximized/fullscreen.
    const flags = Option.getOrUndefined(decodeWindowFlags(contents))

    return flags && (flags.isMaximized !== undefined || flags.isFullScreen !== undefined) ? flags : undefined
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

function hasBounds(state: SavedWindowState): state is WindowState & { x: number; y: number } {
  return state.x !== undefined && state.y !== undefined && state.width !== undefined && state.height !== undefined
}

// Windows reports a window snapped to a screen edge slightly outside the display because of its
// invisible resize borders. Keep those saved bounds instead of falling back to the default window.
const EDGE_TOLERANCE = 16

function within(state: WindowState & { x: number; y: number }, bounds: Rectangle) {
  return (
    state.x >= bounds.x - EDGE_TOLERANCE &&
    state.y >= bounds.y - EDGE_TOLERANCE &&
    state.x + state.width <= bounds.x + bounds.width + EDGE_TOLERANCE &&
    state.y + state.height <= bounds.y + bounds.height + EDGE_TOLERANCE
  )
}
