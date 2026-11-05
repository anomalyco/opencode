/**
 * Main's memory diagnostics. `on` writes one sample per interval to the run's JSONL file: `waiting` for the timer,
 * then `sampling` while the sample is collected and appended. A sample of an earlier attempt, or of a run that turned
 * off, writes nothing. `probing` lists the `WebContents.id`s whose renderer probe has not settled, across runs, so a
 * hung renderer gets one evaluation at a time however often diagnostics turn off and on. `issued` numbers runs and
 * samples alike.
 */
export type MemoryDiagnosticsState =
  | { readonly status: "off"; readonly issued: number; readonly probing: ReadonlySet<number> }
  | {
      readonly status: "on"
      readonly issued: number
      readonly run: number
      readonly sampling: number | undefined
      readonly probing: ReadonlySet<number>
    }
  | { readonly status: "disposed" }

export type MemoryDiagnosticsEvent =
  /** Whether diagnostics should run: the environment asks for them, or the debug bar's stored toggle does. */
  | { readonly type: "synced"; readonly enabled: boolean }
  | { readonly type: "tick"; readonly run: number }
  | { readonly type: "probe.started"; readonly contentsId: number }
  | { readonly type: "probe.settled"; readonly contentsId: number }
  | { readonly type: "sample.collected"; readonly attempt: number; readonly line: string }
  | { readonly type: "sample.written"; readonly attempt: number }
  | { readonly type: "sample.failed"; readonly attempt: number; readonly error: string }
  | { readonly type: "disposed" }

export type MemoryDiagnosticsEffect =
  /** Opens the run's file and, where the platform has it, the heap snapshot signal. */
  | { readonly type: "log.start"; readonly run: number }
  | { readonly type: "log.stop"; readonly run: number }
  | { readonly type: "timer.schedule"; readonly run: number }
  | { readonly type: "timer.cancel" }
  | { readonly type: "sample.collect"; readonly attempt: number }
  | { readonly type: "sample.write"; readonly attempt: number; readonly line: string }
  | { readonly type: "sample.report"; readonly error: string }

export type MemoryDiagnosticsTransition = {
  readonly state: MemoryDiagnosticsState
  readonly effects: readonly MemoryDiagnosticsEffect[]
}

export function createMemoryDiagnosticsState(): MemoryDiagnosticsState {
  return { status: "off", issued: 0, probing: new Set() }
}

export function transitionMemoryDiagnostics(
  state: MemoryDiagnosticsState,
  event: MemoryDiagnosticsEvent,
): MemoryDiagnosticsTransition {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed") {
    return { state: { status: "disposed" }, effects: state.status === "on" ? stop(state.run) : [] }
  }

  if (event.type === "probe.started") {
    if (state.probing.has(event.contentsId)) return { state, effects: [] }

    return { state: { ...state, probing: new Set([...state.probing, event.contentsId]) }, effects: [] }
  }

  if (event.type === "probe.settled") {
    if (!state.probing.has(event.contentsId)) return { state, effects: [] }

    return {
      state: { ...state, probing: new Set([...state.probing].filter((id) => id !== event.contentsId)) },
      effects: [],
    }
  }

  if (event.type === "synced") {
    if (event.enabled === (state.status === "on")) return { state, effects: [] }

    if (state.status === "on") {
      return { state: { status: "off", issued: state.issued, probing: state.probing }, effects: stop(state.run) }
    }
    const run = state.issued + 1

    return {
      state: { status: "on", issued: run, run, sampling: undefined, probing: state.probing },
      effects: [
        { type: "log.start", run },
        { type: "timer.schedule", run },
      ],
    }
  }

  if (state.status === "off") return { state, effects: [] }

  if (event.type === "tick") {
    if (event.run !== state.run || state.sampling !== undefined) return { state, effects: [] }
    const attempt = state.issued + 1

    return { state: { ...state, issued: attempt, sampling: attempt }, effects: [{ type: "sample.collect", attempt }] }
  }

  if (event.attempt !== state.sampling) return { state, effects: [] }

  if (event.type === "sample.collected") {
    return { state, effects: [{ type: "sample.write", attempt: event.attempt, line: event.line }] }
  }

  return {
    state: { ...state, sampling: undefined },
    effects: [
      ...(event.type === "sample.failed" ? [{ type: "sample.report" as const, error: event.error }] : []),
      { type: "timer.schedule", run: state.run },
    ],
  }
}

/** Whether diagnostics run, as the debug bar shows them. */
export function isMemoryDiagnosticsOn(state: MemoryDiagnosticsState) {
  return state.status === "on"
}

/** Whether a renderer's earlier probe is still unanswered, so the next sample skips it. */
export function isRendererProbing(state: MemoryDiagnosticsState, contentsId: number) {
  return state.status !== "disposed" && state.probing.has(contentsId)
}

function stop(run: number): MemoryDiagnosticsEffect[] {
  return [{ type: "timer.cancel" }, { type: "log.stop", run }]
}

// --- The debug bar in a window ---

/**
 * `pinned` keeps the bar open while memory diagnostics run, so they are never silently on; it has no close button
 * then, and the Knobs workspace follows the bar rather than the stored visibility.
 */
export type DebugBarVisibility = "hidden" | "shown" | "pinned"

export function debugBarView(
  bar: { readonly visible: boolean; readonly motion: boolean },
  memory: { readonly on: boolean } | undefined,
) {
  const visibility: DebugBarVisibility = memory?.on ? "pinned" : bar.visible ? "shown" : "hidden"

  return {
    visibility,
    open: visibility !== "hidden",
    closable: visibility === "shown",
    togglable: visibility !== "pinned",
    motion: visibility !== "hidden" && bar.motion,
  }
}
