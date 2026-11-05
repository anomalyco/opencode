// A page's performance recordings: the trace, which records across every tab of the app so one page at a time owns it
// through `SharedTrace`, and the page's own CPU profile and heap snapshot. Each start claims its phase in the same
// event, before any CDP call, and takes the next attempt number, so a second start, a stop or a disposal that arrives
// while Chromium is still starting sees the claim, and a result whose attempt the state no longer holds is stale.
import type { Browser } from "@opencode/plugin-browser/rpc"

/** How long Chromium may take to flush a trace once tracing ended. */
export const TRACE_STOP_TIMEOUT_MS = 10_000

/** A CPU profile stops by itself after this. */
export const CPU_MAX_DURATION_MS = 30_000

/** How long `Profiler.stop` and saving the profile may take. */
export const CPU_STOP_TIMEOUT_MS = 10_000

/** How long taking and saving a heap snapshot may take. */
export const HEAP_CAPTURE_TIMEOUT_MS = 30_000

export type TraceCapture = {
  readonly id: Browser.FileID
  readonly durationMs: number
  readonly incomplete: boolean
}

export type CpuCapture = { readonly id: Browser.FileID; readonly durationMs: number }

export type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown }

/** The page that owns the app-wide trace, and its attempt; undefined while no page traces. */
export type SharedTrace = { readonly owner: string; readonly attempt: number } | undefined

type Recorded = { readonly attempt: number; readonly key: string; readonly resources: readonly string[] }

export type TracePhase =
  | { readonly status: "idle" }
  /** `stopRequested`: a stop or the page's disposal arrived before Chromium confirmed the start. */
  | (Recorded & {
      readonly status: "starting"
      readonly pid: number
      readonly durationMs: number
      readonly stopRequested: boolean
    })
  | (Recorded & { readonly status: "recording"; readonly pid: number; readonly startedAt: number })
  | (Recorded & { readonly status: "stopping" })
  /** The export settled; a later stop answers with the same outcome. */
  | (Recorded & { readonly status: "stopped" })

export type CpuPhase =
  | { readonly status: "idle" }
  | (Recorded & { readonly status: "starting"; readonly stopRequested: boolean })
  | (Recorded & { readonly status: "recording" })
  | (Recorded & { readonly status: "stopping" })
  | (Recorded & { readonly status: "stopped" })

export type HeapPhase = { readonly status: "idle" } | { readonly status: "capturing"; readonly attempt: number }

export type ProfilingState = {
  /** Identifies this page as the owner of the shared trace. */
  readonly owner: string
  /** `disposing` waits for the trace and CPU profile to stop, so Chromium never keeps recording a closed page. */
  readonly lifecycle: "open" | "disposing" | "disposed"
  /** The last attempt handed out. */
  readonly issued: number
  readonly trace: TracePhase
  readonly cpu: CpuPhase
  readonly heap: HeapPhase
}

export type ProfilingEvent =
  | { readonly type: "frame.navigated"; readonly url: string }
  | {
      readonly type: "trace.start.requested"
      readonly key: string
      readonly pid: number
      readonly durationMs: number
      readonly resources: readonly string[]
    }
  | { readonly type: "trace.start.succeeded"; readonly attempt: number; readonly now: number }
  | { readonly type: "trace.start.failed"; readonly attempt: number; readonly error: unknown }
  | { readonly type: "trace.duration.elapsed"; readonly attempt: number; readonly now: number }
  | { readonly type: "trace.stop.requested"; readonly now: number }
  | { readonly type: "trace.stop.succeeded"; readonly attempt: number; readonly value: TraceCapture }
  /** The export failed, or did not finish within `TRACE_STOP_TIMEOUT_MS`. */
  | { readonly type: "trace.stop.failed"; readonly attempt: number; readonly error: unknown }
  | { readonly type: "cpu.start.requested"; readonly key: string; readonly resources: readonly string[] }
  | { readonly type: "cpu.start.succeeded"; readonly attempt: number }
  | { readonly type: "cpu.start.failed"; readonly attempt: number; readonly error: unknown }
  | { readonly type: "cpu.duration.elapsed"; readonly attempt: number }
  | { readonly type: "cpu.stop.requested" }
  | { readonly type: "cpu.stop.succeeded"; readonly attempt: number; readonly value: CpuCapture }
  /** The profile failed to stop or save, or did not within `CPU_STOP_TIMEOUT_MS`. */
  | { readonly type: "cpu.stop.failed"; readonly attempt: number; readonly error: unknown }
  | { readonly type: "heap.requested"; readonly resources: readonly string[] }
  | { readonly type: "heap.succeeded"; readonly attempt: number; readonly id: Browser.FileID }
  /** The snapshot failed, or did not finish within `HEAP_CAPTURE_TIMEOUT_MS`. */
  | { readonly type: "heap.failed"; readonly attempt: number; readonly error: unknown }
  | { readonly type: "dispose.requested"; readonly now: number }

export type ProfilingTimer = "trace.duration" | "trace.stop" | "cpu.duration" | "cpu.stop" | "heap"

export type ProfilingEffect =
  | { readonly type: "start-trace"; readonly attempt: number }
  | {
      readonly type: "end-trace"
      readonly attempt: number
      readonly pid: number
      readonly durationMs: number
      readonly resources: readonly string[]
    }
  | { readonly type: "start-cpu"; readonly attempt: number }
  | { readonly type: "stop-cpu"; readonly attempt: number; readonly resources: readonly string[] }
  | { readonly type: "capture-heap"; readonly attempt: number; readonly resources: readonly string[] }
  | { readonly type: "schedule"; readonly timer: ProfilingTimer; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "cancel"; readonly timer: ProfilingTimer }
  | { readonly type: "settle-trace-start"; readonly attempt: number; readonly outcome: Settled<undefined> }
  | { readonly type: "settle-trace-stop"; readonly attempt: number; readonly outcome: Settled<TraceCapture> }
  | { readonly type: "settle-cpu-start"; readonly attempt: number; readonly outcome: Settled<undefined> }
  | { readonly type: "settle-cpu-stop"; readonly attempt: number; readonly outcome: Settled<CpuCapture> }
  | { readonly type: "settle-heap"; readonly attempt: number; readonly outcome: Settled<Browser.FileID> }
  | { readonly type: "settle-dispose" }

/** Why a request was refused at once; the driver maps each to its agent-facing message. */
export type ProfilingRefusal =
  | "trace-active-here"
  | "trace-active-elsewhere"
  | "no-trace"
  | "cpu-active"
  | "no-cpu"
  | "heap-active"
  | "closed"

/** The answer to a request event: wait for the settle of `attempt`, or fail at once. */
export type ProfilingReply =
  | { readonly status: "pending"; readonly attempt: number }
  | { readonly status: "refused"; readonly refusal: ProfilingRefusal }

export type ProfilingTransition = {
  readonly state: ProfilingState
  readonly shared: SharedTrace
  readonly effects: readonly ProfilingEffect[]
  /** Set for the request events: the start, stop and heap requests. */
  readonly reply?: ProfilingReply
}

const IDLE = { status: "idle" } as const

export const createProfilingState = (owner: string): ProfilingState => ({
  owner,
  lifecycle: "open",
  issued: 0,
  trace: IDLE,
  cpu: IDLE,
  heap: IDLE,
})

export function transitionProfiling(
  state: ProfilingState,
  shared: SharedTrace,
  event: ProfilingEvent,
): ProfilingTransition {
  switch (event.type) {
    case "frame.navigated":
      return navigated(state, shared, event.url)
    case "trace.start.requested": {
      if (state.lifecycle !== "open") return refuse(state, shared, "closed")

      if (shared || active(state.trace))
        return refuse(state, shared, !shared || shared.owner === state.owner ? "trace-active-here" : "trace-active-elsewhere")
      const attempt = state.issued + 1

      return {
        state: {
          ...state,
          issued: attempt,
          trace: {
            status: "starting",
            attempt,
            key: event.key,
            pid: event.pid,
            durationMs: event.durationMs,
            resources: event.resources,
            stopRequested: false,
          },
        },
        shared: { owner: state.owner, attempt },
        effects: [{ type: "start-trace", attempt }],
        reply: { status: "pending", attempt },
      }
    }
    case "trace.start.succeeded": {
      const trace = state.trace

      if (trace.status !== "starting" || trace.attempt !== event.attempt) return unchanged(state, shared)
      const started = { type: "settle-trace-start", attempt: trace.attempt, outcome: { ok: true, value: undefined } } as const

      if (trace.stopRequested || state.lifecycle !== "open")
        return {
          state: { ...state, trace: { status: "stopping", attempt: trace.attempt, key: trace.key, resources: trace.resources } },
          shared,
          effects: [started, ...endTrace(trace, trace.pid, 0)],
        }

      return {
        state: {
          ...state,
          trace: {
            status: "recording",
            attempt: trace.attempt,
            key: trace.key,
            pid: trace.pid,
            startedAt: event.now,
            resources: trace.resources,
          },
        },
        shared,
        effects: [started, { type: "schedule", timer: "trace.duration", attempt: trace.attempt, delayMs: trace.durationMs }],
      }
    }
    case "trace.start.failed": {
      const trace = state.trace

      if (trace.status !== "starting" || trace.attempt !== event.attempt) return unchanged(state, shared)
      const failed = { ok: false, error: event.error } as const

      return settleDispose({
        state: { ...state, trace: IDLE },
        shared: release(state, shared, trace.attempt),
        effects: [
          { type: "settle-trace-start", attempt: trace.attempt, outcome: failed },
          ...(trace.stopRequested ? [{ type: "settle-trace-stop", attempt: trace.attempt, outcome: failed } as const] : []),
        ],
      })
    }
    case "trace.duration.elapsed":
      if (state.trace.status !== "recording" || state.trace.attempt !== event.attempt) return unchanged(state, shared)

      return stopTrace(state, shared, event.now)
    case "trace.stop.requested":
      return stopTrace(state, shared, event.now)
    case "trace.stop.succeeded":
    case "trace.stop.failed": {
      const trace = state.trace

      if (trace.status !== "stopping" || trace.attempt !== event.attempt) return unchanged(state, shared)

      return settleDispose({
        state: { ...state, trace: { ...trace, status: "stopped" } },
        shared: release(state, shared, trace.attempt),
        effects: [
          { type: "cancel", timer: "trace.stop" },
          {
            type: "settle-trace-stop",
            attempt: trace.attempt,
            outcome: event.type === "trace.stop.succeeded" ? { ok: true, value: event.value } : { ok: false, error: event.error },
          },
        ],
      })
    }
    case "cpu.start.requested": {
      if (state.lifecycle !== "open") return refuse(state, shared, "closed")

      if (active(state.cpu)) return refuse(state, shared, "cpu-active")
      const attempt = state.issued + 1

      return {
        state: {
          ...state,
          issued: attempt,
          cpu: { status: "starting", attempt, key: event.key, resources: event.resources, stopRequested: false },
        },
        shared,
        effects: [{ type: "start-cpu", attempt }],
        reply: { status: "pending", attempt },
      }
    }
    case "cpu.start.succeeded": {
      const cpu = state.cpu

      if (cpu.status !== "starting" || cpu.attempt !== event.attempt) return unchanged(state, shared)
      const started = { type: "settle-cpu-start", attempt: cpu.attempt, outcome: { ok: true, value: undefined } } as const

      if (cpu.stopRequested || state.lifecycle !== "open")
        return {
          state: { ...state, cpu: { status: "stopping", attempt: cpu.attempt, key: cpu.key, resources: cpu.resources } },
          shared,
          effects: [started, ...stopCpu(cpu)],
        }

      return {
        state: { ...state, cpu: { status: "recording", attempt: cpu.attempt, key: cpu.key, resources: cpu.resources } },
        shared,
        effects: [started, { type: "schedule", timer: "cpu.duration", attempt: cpu.attempt, delayMs: CPU_MAX_DURATION_MS }],
      }
    }
    case "cpu.start.failed": {
      const cpu = state.cpu

      if (cpu.status !== "starting" || cpu.attempt !== event.attempt) return unchanged(state, shared)
      const failed = { ok: false, error: event.error } as const

      return settleDispose({
        state: { ...state, cpu: IDLE },
        shared,
        effects: [
          { type: "settle-cpu-start", attempt: cpu.attempt, outcome: failed },
          ...(cpu.stopRequested ? [{ type: "settle-cpu-stop", attempt: cpu.attempt, outcome: failed } as const] : []),
        ],
      })
    }
    case "cpu.duration.elapsed":
      if (state.cpu.status !== "recording" || state.cpu.attempt !== event.attempt) return unchanged(state, shared)

      return requestCpuStop(state, shared)
    case "cpu.stop.requested":
      return requestCpuStop(state, shared)
    case "cpu.stop.succeeded":
    case "cpu.stop.failed": {
      const cpu = state.cpu

      if (cpu.status !== "stopping" || cpu.attempt !== event.attempt) return unchanged(state, shared)

      return settleDispose({
        state: { ...state, cpu: { ...cpu, status: "stopped" } },
        shared,
        effects: [
          { type: "cancel", timer: "cpu.stop" },
          {
            type: "settle-cpu-stop",
            attempt: cpu.attempt,
            outcome: event.type === "cpu.stop.succeeded" ? { ok: true, value: event.value } : { ok: false, error: event.error },
          },
        ],
      })
    }
    case "heap.requested": {
      if (state.lifecycle !== "open") return refuse(state, shared, "closed")

      if (state.heap.status === "capturing") return refuse(state, shared, "heap-active")
      const attempt = state.issued + 1

      return {
        state: { ...state, issued: attempt, heap: { status: "capturing", attempt } },
        shared,
        effects: [
          { type: "schedule", timer: "heap", attempt, delayMs: HEAP_CAPTURE_TIMEOUT_MS },
          { type: "capture-heap", attempt, resources: event.resources },
        ],
        reply: { status: "pending", attempt },
      }
    }
    case "heap.succeeded":
    case "heap.failed":
      if (state.heap.status !== "capturing" || state.heap.attempt !== event.attempt) return unchanged(state, shared)

      return {
        state: { ...state, heap: IDLE },
        shared,
        effects: [
          { type: "cancel", timer: "heap" },
          {
            type: "settle-heap",
            attempt: event.attempt,
            outcome: event.type === "heap.succeeded" ? { ok: true, value: event.id } : { ok: false, error: event.error },
          },
        ],
      }
    case "dispose.requested": {
      if (state.lifecycle !== "open") return unchanged(state, shared)
      const disposing = { ...state, lifecycle: "disposing" as const }
      const trace = active(state.trace) ? stopTrace(disposing, shared, event.now) : unchanged(disposing, shared)
      const cpu = active(trace.state.cpu) ? requestCpuStop(trace.state, trace.shared) : unchanged(trace.state, trace.shared)

      return settleDispose({ state: cpu.state, shared: cpu.shared, effects: [...trace.effects, ...cpu.effects] })
    }
  }
}

/** What a stop asks permission for: the recording's pages and an identity that changes with each recording. */
export function selectProfilingTarget(state: ProfilingState, type: "trace" | "cpu"): Browser.Target {
  const phase = type === "trace" ? state.trace : state.cpu

  if (phase.status === "idle") return { resources: [], key: "" }

  return { resources: [...phase.resources].sort(), key: phase.key }
}

/** Whether the export of `attempt` is still wanted; a timed-out or disposed export stops reading. */
export function isTraceStoppingAttempt(state: ProfilingState, attempt: number) {
  return state.trace.status === "stopping" && state.trace.attempt === attempt
}

function navigated(state: ProfilingState, shared: SharedTrace, url: string): ProfilingTransition {
  const trace =
    recordsPages(state.trace) && !state.trace.resources.includes(url) ? withResource(state.trace, url) : state.trace
  const cpu = recordsPages(state.cpu) && !state.cpu.resources.includes(url) ? withResource(state.cpu, url) : state.cpu

  if (trace === state.trace && cpu === state.cpu) return unchanged(state, shared)

  return { state: { ...state, trace, cpu }, shared, effects: [] }
}

function stopTrace(state: ProfilingState, shared: SharedTrace, now: number): ProfilingTransition {
  const trace = state.trace

  if (trace.status === "idle") return refuse(state, shared, "no-trace")
  const reply = { status: "pending", attempt: trace.attempt } as const

  if (trace.status === "starting")
    return {
      state: trace.stopRequested ? state : { ...state, trace: { ...trace, stopRequested: true } },
      shared,
      effects: [],
      reply,
    }

  if (trace.status !== "recording") return { state, shared, effects: [], reply }

  return {
    state: { ...state, trace: { status: "stopping", attempt: trace.attempt, key: trace.key, resources: trace.resources } },
    shared,
    effects: [
      { type: "cancel", timer: "trace.duration" },
      ...endTrace(trace, trace.pid, Math.max(0, now - trace.startedAt)),
    ],
    reply,
  }
}

function requestCpuStop(state: ProfilingState, shared: SharedTrace): ProfilingTransition {
  const cpu = state.cpu

  if (cpu.status === "idle") return refuse(state, shared, "no-cpu")
  const reply = { status: "pending", attempt: cpu.attempt } as const

  if (cpu.status === "starting")
    return {
      state: cpu.stopRequested ? state : { ...state, cpu: { ...cpu, stopRequested: true } },
      shared,
      effects: [],
      reply,
    }

  if (cpu.status !== "recording") return { state, shared, effects: [], reply }

  return {
    state: { ...state, cpu: { ...cpu, status: "stopping" } },
    shared,
    effects: [{ type: "cancel", timer: "cpu.duration" }, ...stopCpu(cpu)],
    reply,
  }
}

function endTrace(trace: Recorded, pid: number, durationMs: number): readonly ProfilingEffect[] {
  return [
    { type: "schedule", timer: "trace.stop", attempt: trace.attempt, delayMs: TRACE_STOP_TIMEOUT_MS },
    { type: "end-trace", attempt: trace.attempt, pid, durationMs, resources: trace.resources },
  ]
}

function stopCpu(cpu: Recorded): readonly ProfilingEffect[] {
  return [
    { type: "schedule", timer: "cpu.stop", attempt: cpu.attempt, delayMs: CPU_STOP_TIMEOUT_MS },
    { type: "stop-cpu", attempt: cpu.attempt, resources: cpu.resources },
  ]
}

/** A disposal finishes once neither the trace nor the CPU profile is still starting, recording or stopping. */
function settleDispose(next: ProfilingTransition): ProfilingTransition {
  if (next.state.lifecycle !== "disposing" || active(next.state.trace) || active(next.state.cpu)) return next

  return {
    ...next,
    state: { ...next.state, lifecycle: "disposed" },
    effects: [...next.effects, { type: "settle-dispose" }],
  }
}

/** Frees the app-wide trace when this page's `attempt` holds it. */
function release(state: ProfilingState, shared: SharedTrace, attempt: number): SharedTrace {
  return shared?.owner === state.owner && shared.attempt === attempt ? undefined : shared
}

function active(phase: TracePhase | CpuPhase) {
  return phase.status === "starting" || phase.status === "recording" || phase.status === "stopping"
}

function recordsPages<Phase extends TracePhase | CpuPhase>(
  phase: Phase,
): phase is Extract<Phase, { status: "starting" | "recording" }> {
  return phase.status === "starting" || phase.status === "recording"
}

function withResource<Phase extends { readonly resources: readonly string[] }>(phase: Phase, url: string): Phase {
  return { ...phase, resources: [...phase.resources, url] }
}

function refuse(state: ProfilingState, shared: SharedTrace, refusal: ProfilingRefusal): ProfilingTransition {
  return { state, shared, effects: [], reply: { status: "refused", refusal } }
}

function unchanged(state: ProfilingState, shared: SharedTrace): ProfilingTransition {
  return { state, shared, effects: [] }
}
