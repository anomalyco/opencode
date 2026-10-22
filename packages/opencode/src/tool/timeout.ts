import { Effect, Fiber } from "effect"

/** A time limit in milliseconds, or `false` for no limit. */
export type Setting = number | false

export interface Limit {
  readonly ms: Setting
  /** Where the limit came from, quoted in the error a call that exceeds it ends with. */
  readonly source: string
}

export interface Call {
  /** Aborts when the turn is aborted or the call exceeds its limit. */
  readonly signal: AbortSignal
  /** Stops the clock while `effect` runs, so time spent waiting on a person does not count. */
  readonly hold: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

export const DEFAULT_MS = 30 * 60 * 1000

/** Room a tool's own per-call timeout gets to stop the work and report it before the hard limit ends the call. */
export const CALL_GRACE_MS = 60 * 1000

// Tools that legitimately wait on a person or on a whole subagent run. These
// stand in for a declaration from the tool's provider, so a plugin's own
// `timeout` replaces them and a user's `tool_timeout.<tool>` beats both.
const UNLIMITED = new Set(["question", "task", "call_omo_agent"])

/** Limit for built-in file tools, which never legitimately run this long: a call that does is hung on I/O. */
export const FILE_TOOL_MS = 10 * 60 * 1000

// A lower `tool_timeout.default` still applies to these; a higher one does not lift them.
const FILE_TOOLS = new Set(["read", "write", "edit", "grep", "glob"])

/**
 * The most specific setting wins; each level is only a default for the one
 * below it:
 *
 * 1. the user's `tool_timeout.<tool>`, higher or lower;
 * 2. the tool provider's default: a plugin tool's `timeout`, an MCP server's
 *    `tool_timeout`, the built-in exemptions, or the file tools' 10 minutes;
 * 3. the user's `tool_timeout.default`, else 30 minutes.
 *
 * A per-call timeout the tool itself takes (bash's `timeout` argument) raises
 * levels 2 and 3 to that timeout plus a grace period, never level 1.
 */
export function resolve(input: {
  tool: string
  config?: Readonly<Record<string, Setting>>
  declared?: Limit
  call?: number
}): Limit {
  if (input.config && input.tool !== "default" && Object.hasOwn(input.config, input.tool))
    return { ms: input.config[input.tool], source: `config: tool_timeout.${input.tool}` }
  const limit = fallback(input)
  if (input.call === undefined || limit.ms === false) return limit
  const raised = input.call + CALL_GRACE_MS
  if (raised <= limit.ms) return limit
  return { ms: raised, source: "the call's own timeout argument" }
}

/**
 * Runs the call `fork` starts under `limit`. A call still running when the
 * limit elapses is ended the way an abort ends it: its signal aborts, its fiber
 * is interrupted, and the returned promise rejects with the limit and its
 * source without waiting for the tool to notice. An abort of `parent` is
 * forwarded to the call's signal and otherwise left to the tool, as before.
 */
export function run<A, E>(
  limit: Limit,
  parent: AbortSignal | undefined,
  fork: (call: Call) => Fiber.Fiber<A, E>,
): Promise<A> {
  const controller = new AbortController()
  const forward = () => controller.abort(parent?.reason)
  if (parent?.aborted) forward()
  parent?.addEventListener("abort", forward, { once: true })
  const join = (fiber: Fiber.Fiber<A, E>) => Effect.runPromise(Fiber.join(fiber))
  const limitMs = limit.ms
  if (limitMs === false) {
    return join(fork({ signal: controller.signal, hold: (effect) => effect })).finally(() =>
      parent?.removeEventListener("abort", forward),
    )
  }

  const state = {
    remaining: limitMs,
    started: Date.now(),
    holds: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    fiber: undefined as Fiber.Fiber<A, E> | undefined,
  }
  const expired = Promise.withResolvers<never>()
  const arm = () => {
    state.started = Date.now()
    state.timer = setTimeout(() => {
      const error = new Error(`tool call exceeded its ${format(limitMs)} limit (${limit.source})`)
      controller.abort(error)
      if (state.fiber) Effect.runFork(Fiber.interrupt(state.fiber))
      expired.reject(error)
    }, state.remaining)
  }
  const pause = () => {
    state.holds++
    if (state.holds !== 1) return
    clearTimeout(state.timer)
    state.remaining = Math.max(0, state.remaining - (Date.now() - state.started))
  }
  const resume = () => {
    state.holds--
    if (state.holds === 0 && !controller.signal.aborted) arm()
  }
  // Armed before forking: the fiber may reach `hold` synchronously, and pausing must find the timer.
  arm()
  state.fiber = fork({
    signal: controller.signal,
    hold: (effect) =>
      Effect.acquireUseRelease(
        Effect.sync(pause),
        () => effect,
        () => Effect.sync(resume),
      ),
  })

  return Promise.race([join(state.fiber), expired.promise]).finally(() => {
    clearTimeout(state.timer)
    parent?.removeEventListener("abort", forward)
  })
}

export function format(ms: number) {
  return (
    (
      [
        [Math.floor(ms / 3_600_000), "h"],
        [Math.floor((ms % 3_600_000) / 60_000), "m"],
        [Math.floor((ms % 60_000) / 1000), "s"],
        [ms % 1000, "ms"],
      ] as const
    )
      .filter((part) => part[0] > 0)
      .map((part) => `${part[0]}${part[1]}`)
      .join("") || "0ms"
  )
}

function fallback(input: { tool: string; config?: Readonly<Record<string, Setting>>; declared?: Limit }): Limit {
  if (input.declared) return input.declared
  if (UNLIMITED.has(input.tool)) return { ms: false, source: "built-in default" }
  const configured = input.config?.default
  if (FILE_TOOLS.has(input.tool) && (configured === undefined || configured === false || configured > FILE_TOOL_MS))
    return {
      ms: FILE_TOOL_MS,
      source: `built-in default for ${input.tool}, set tool_timeout.${input.tool} to change it`,
    }
  if (configured !== undefined) return { ms: configured, source: "config: tool_timeout.default" }
  return { ms: DEFAULT_MS, source: "default" }
}

export * as ToolTimeout from "./timeout"
