// Same page size as the TUI shell output viewer; only this much recent output is retained and rendered.
export const SHELL_OUTPUT_TAIL_BYTES = 64 * 1024

export const SHELL_POLL_MS = 1_000

export const SHELL_MAX_BACKOFF_MS = 16_000

/** A read that has not settled by then counts as failed, so a hung request cannot stop the follower. */
export const SHELL_READ_TIMEOUT_MS = 15_000

/** Retries for a shell that is no longer running before its output is left as it is. */
export const SHELL_EXITED_MAX_RETRIES = 3

export type ShellCachedOutput = { readonly cursor: number; readonly output: string; readonly complete: boolean }

export type ShellOutputPage = { readonly output: string; readonly cursor: number; readonly size: number }

type Progress = { readonly attempt: number; readonly cursor: number; readonly output: string }

/**
 * Reads one shell's output. `reading` has one request in flight; `final` means it started after the shell stopped
 * running, so reaching the end completes the output. `waiting` is the poll interval while the shell runs, or a backoff
 * after `failures` consecutive failed reads. `complete` and `failed` read again if the shell turns out to be running;
 * a `missing` shell is gone from the server for good.
 */
export type ShellFollowerState =
  | (Progress & {
      readonly status: "reading"
      readonly running: boolean
      readonly final: boolean
      readonly failures: number
    })
  | (Progress & {
      readonly status: "waiting"
      readonly running: boolean
      readonly failures: number
      readonly delayMs: number
    })
  | (Progress & { readonly status: "complete" })
  | (Progress & { readonly status: "failed" })
  | (Progress & { readonly status: "missing" })
  | { readonly status: "disposed" }

export type ShellFollowerEvent =
  | { readonly type: "running.changed"; readonly running: boolean }
  | { readonly type: "read.succeeded"; readonly attempt: number; readonly page: ShellOutputPage }
  | { readonly type: "read.missing"; readonly attempt: number }
  | { readonly type: "read.failed"; readonly attempt: number }
  | { readonly type: "wait.elapsed"; readonly attempt: number }
  | { readonly type: "disposed" }

/** `read` and `wait` replace the follower's single pending timer; `cancel` clears it. */
export type ShellFollowerEffect =
  | { readonly type: "read"; readonly attempt: number; readonly cursor: number }
  | { readonly type: "wait"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "cancel" }
  | { readonly type: "cache"; readonly cursor: number; readonly output: string; readonly complete: boolean }
  | { readonly type: "cache-missing" }
  | { readonly type: "emit"; readonly output: string }

export type ShellFollowerTransition = {
  readonly state: ShellFollowerState
  readonly effects: readonly ShellFollowerEffect[]
}

const NO_EFFECTS: readonly ShellFollowerEffect[] = Object.freeze([])

const CANCEL: ShellFollowerEffect = Object.freeze({ type: "cancel" })

const DISPOSED: ShellFollowerState = Object.freeze({ status: "disposed" })

export function createShellFollowerState(input: {
  cached: ShellCachedOutput | undefined
  missing: boolean
  running: boolean
}): ShellFollowerTransition {
  const cursor = input.cached?.cursor ?? 0
  const output = input.cached?.output ?? ""
  const emit: ShellFollowerEffect[] = input.cached ? [{ type: "emit", output }] : []

  if (input.missing) return { state: { status: "missing", attempt: 0, cursor, output }, effects: emit }

  if (input.cached?.complete && !input.running)
    return { state: { status: "complete", attempt: 0, cursor, output }, effects: emit }

  return {
    state: {
      status: "reading",
      attempt: 1,
      cursor,
      output,
      running: input.running,
      final: !input.running,
      failures: 0,
    },
    effects: [
      // A shell believed complete is running after all, so its cached output is no longer final.
      ...(input.cached?.complete ? [{ type: "cache", cursor, output, complete: false } as const] : []),
      { type: "read", attempt: 1, cursor },
      ...emit,
    ],
  }
}

export function transitionShellFollower(state: ShellFollowerState, event: ShellFollowerEvent): ShellFollowerTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed")
    return {
      state: DISPOSED,
      effects: state.status === "reading" || state.status === "waiting" ? [CANCEL] : NO_EFFECTS,
    }

  if (state.status === "missing") return { state, effects: NO_EFFECTS }

  if (event.type === "running.changed") return runningChanged(state, event.running)

  if (event.type === "wait.elapsed") {
    if (state.status !== "waiting" || event.attempt !== state.attempt) return { state, effects: NO_EFFECTS }

    return read(state, state.running, state.failures)
  }

  if (state.status !== "reading" || event.attempt !== state.attempt) return { state, effects: NO_EFFECTS }

  if (event.type === "read.missing")
    return {
      state: { status: "missing", attempt: state.attempt, cursor: state.cursor, output: state.output },
      effects: [CANCEL, { type: "cache-missing" }],
    }

  if (event.type === "read.failed") {
    const failures = state.failures + 1

    if (!state.running && failures > SHELL_EXITED_MAX_RETRIES)
      return {
        state: { status: "failed", attempt: state.attempt, cursor: state.cursor, output: state.output },
        effects: [CANCEL],
      }

    return backoff(state, state.running, failures)
  }

  const page = event.page
  const advanced = page.cursor > state.cursor
  const cursor = Math.max(state.cursor, page.cursor)
  const output = (state.output + page.output).slice(-SHELL_OUTPUT_TAIL_BYTES)
  const emit = { type: "emit", output } as const
  const attempt = state.attempt + 1

  if (state.running)
    return {
      state: { status: "waiting", attempt, cursor, output, running: true, failures: 0, delayMs: SHELL_POLL_MS },
      effects: [
        { type: "cache", cursor, output, complete: false },
        { type: "wait", attempt, delayMs: SHELL_POLL_MS },
        emit,
      ],
    }

  // A read that started while the shell ran may have missed its last output, so the shell is read once more.
  if (!state.final || (cursor < page.size && advanced))
    return {
      state: { status: "reading", attempt, cursor, output, running: false, final: true, failures: 0 },
      effects: [{ type: "cache", cursor, output, complete: false }, { type: "read", attempt, cursor }, emit],
    }

  return {
    state: { status: "complete", attempt: state.attempt, cursor, output },
    effects: [CANCEL, { type: "cache", cursor, output, complete: cursor >= page.size }, emit],
  }
}

function runningChanged(
  state: Exclude<ShellFollowerState, { status: "disposed" | "missing" }>,
  running: boolean,
): ShellFollowerTransition {
  if (state.status === "complete" || state.status === "failed") {
    if (!running) return { state, effects: NO_EFFECTS }
    const next = read(state, true, 0)

    if (state.status === "failed") return next

    return {
      state: next.state,
      effects: [{ type: "cache", cursor: state.cursor, output: state.output, complete: false }, ...next.effects],
    }
  }

  if (running === state.running) return { state, effects: NO_EFFECTS }

  // The read in flight still counts; the next one decides whether the output is final.
  if (state.status === "reading")
    return { state: { ...state, running, final: state.final && !running }, effects: NO_EFFECTS }

  if (running) return { state: { ...state, running }, effects: NO_EFFECTS }

  // The shell stopped between polls: read its final output now instead of after the interval.
  if (state.failures === 0) return read(state, false, 0)

  if (state.failures > SHELL_EXITED_MAX_RETRIES)
    return {
      state: { status: "failed", attempt: state.attempt, cursor: state.cursor, output: state.output },
      effects: [CANCEL],
    }

  return { state: { ...state, running }, effects: NO_EFFECTS }
}

function read(state: Progress, running: boolean, failures: number): ShellFollowerTransition {
  const attempt = state.attempt + 1

  return {
    state: {
      status: "reading",
      attempt,
      cursor: state.cursor,
      output: state.output,
      running,
      final: !running,
      failures,
    },
    effects: [{ type: "read", attempt, cursor: state.cursor }],
  }
}

function backoff(state: Progress, running: boolean, failures: number): ShellFollowerTransition {
  const attempt = state.attempt + 1
  const delayMs = Math.min(SHELL_MAX_BACKOFF_MS, SHELL_POLL_MS * 2 ** (failures - 1))

  return {
    state: { status: "waiting", attempt, cursor: state.cursor, output: state.output, running, failures, delayMs },
    effects: [{ type: "wait", attempt, delayMs }],
  }
}
