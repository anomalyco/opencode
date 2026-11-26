// Messages between the page and the widget workers.

/** A user event (widgets.md, Events; widgets-fullscreen.md; widgets-input.md). */
export interface WidgetEvent {
  id: string
  type: "press" | "change" | "pointer" | "fullscreen" | "key" | "focus" | "capture"
  value?: unknown
  /** `fullscreen` events: the close button's area in the root node's coordinates, `null` when leaving. */
  close?: Rect | null
}

/** A rectangle in logical pixels. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** What a canvas draw step or a live `widget.frame()` knows of its frame. */
export interface Frame {
  id: string | null
  t: number
  dt: number
  width: number
  height: number
  scale: number
  pointer: { x: number; y: number; down: boolean } | null
  dark: boolean
  fullscreen: boolean
  /** The full-screen close button's area in this canvas's coordinates when it overlaps the canvas, else `null`. */
  close: Rect | null
}

/** A view node: `{ type, ...props }`. */
export interface ViewNode {
  type: string
  [prop: string]: unknown
}

export interface StepOutput {
  state?: unknown
  view: ViewNode
  submit?: unknown
  dismiss?: true
  send?: { value: unknown; wake: boolean }
}

/** A failure: the language's (`type`, `kind`, `line`, `column`) or the host's. */
export interface ErrorInfo {
  /** The phase it belongs to when not the step's or the run's: `view` for a view that breaks a rule of views. */
  phase?: string
  type: string
  kind?: string
  message: string
  line?: number
  column?: number
}

export type LiveExit =
  | { type: "finished"; result: unknown }
  | { type: "failed"; error: ErrorInfo }
  | { type: "stopped" }

export type ToWorker =
  | { t: "init"; module: WebAssembly.Module }
  | { t: "compile"; pid: number; program: string; live: boolean }
  | { t: "release"; pid: number }
  | { t: "open"; wid: number; pid: number; data: string }
  | { t: "event"; wid: number; event: WidgetEvent }
  | { t: "draw"; wid: number; req: number; frame: Frame }
  | { t: "close"; wid: number }
  | {
      t: "live"
      wid: number
      pid: number
      data: string
      hosts?: string[]
      localNetwork?: boolean
      sliceBudgetMs?: number
      /** The live input's `gpu` (widgets-gpu.md). */
      gpu?: { available: boolean; format: string }
    }
  | { t: "deliver"; wid: number; message: unknown }
  | { t: "pause"; wid: number }
  | { t: "resume"; wid: number }
  | { t: "stop"; wid: number }
  | { t: "stats"; req: number }

export type FromWorker =
  | { t: "ready" }
  | { t: "compiled"; pid: number; error?: ErrorInfo; ms: number }
  | { t: "step"; wid: number; phase: "init" | "event"; output?: StepOutput; error?: ErrorInfo; ms: number }
  | { t: "drawn"; wid: number; req: number; commands?: unknown[][]; error?: ErrorInfo; ms: number }
  | { t: "posts"; wid: number; messages: unknown[] }
  /** `phase`: a program error the run survives, else a plain warning. */
  | { t: "warning"; wid: number; message: string; phase?: string }
  | { t: "exit"; wid: number; exit: LiveExit }
  | { t: "crash"; message: string; wid?: number }
  | { t: "stats"; req: number; wasmBytes: number; programs: number; widgets: number }

/** The prelude<->host contract this host implements (widgets.md, Protocol). */
export const PROTOCOL = 2
/** Why a program built for another contract isn't run: a program error for an older one, a client error otherwise. */
export const OLDER = "This widget was built with an older widget runtime; ask the agent to post it again"
export const NEWER = "This widget needs a newer version of this app"

/** The contract `program` was built for: its first line's `__widget_protocol`, or 1 without one. */
export function protocol(program: string): number {
  const end = program.indexOf("\n")
  const declared = /^const __widget_protocol = (\d+)$/.exec(end < 0 ? program : program.slice(0, end))
  return declared ? Number(declared[1]) : 1
}

/** The contract's budgets. */
export const STEP_TIMEOUT_MS = 250
export const DRAW_BUDGET_MS = 8
/** A draw step is cut off here; past `DRAW_BUDGET_MS` it already counts as an overrun. */
export const DRAW_TIMEOUT_MS = 100
export const MAX_COMMANDS = 2000
export const OVERRUNS_TO_FREEZE = 3
export const SLICE_BUDGET_MS = 50
export const MAX_FPS = 60
export const SHADER_FRAME_BUDGET_MS = 50
/** GPU work still unfinished this long after its submit is a hang (widgets-gpu.md, GPU hang): its canvases stop. */
export const GPU_HANG_MS = 250
export const MAX_SHADER_BYTES = 16 * 1024
export const MAX_SHADER_VALUES = 16

/**
 * A GPU batch's ops as the program posted them (widgets-gpu.md, Transport): JSON writes a non-finite number as `null`,
 * so the runner lists those by path in `nonFinite`, `[[path, "NaN" | "Infinity" | "-Infinity"], …]`; they go back in
 * place, and `nonFinite` goes.
 */
export function restoreNonFinite(batch: { ops?: unknown; nonFinite?: unknown }) {
  const list = batch.nonFinite as Array<[Array<string | number>, string]> | undefined
  if (list === undefined) return
  delete batch.nonFinite
  for (const [path, value] of list) {
    if (path.length === 0) {
      batch.ops = Number(value)
      continue
    }
    let at = batch.ops as Record<string | number, unknown>
    for (let i = 0; i < path.length - 1; i++) at = at[path[i]!] as Record<string | number, unknown>
    at[path[path.length - 1]!] = Number(value)
  }
}
