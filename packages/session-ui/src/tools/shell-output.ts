import { isShellNotFoundError, type ShellOutputInput, type ShellOutputOutput } from "@opencode/client/promise"
import {
  createShellFollowerState,
  SHELL_READ_TIMEOUT_MS,
  transitionShellFollower,
  type ShellCachedOutput,
  type ShellFollowerEffect,
  type ShellFollowerEvent,
} from "./shell-output-machine"

// Virtualized timelines remount shell tools frequently. Output is remembered per shell so a remount resumes from its
// cursor instead of re-reading from zero. Missing shells are remembered apart from the output, which holds up to 64 KiB
// per shell, so viewing many other shells cannot evict them and a shell the server dropped is never requested again.
const outputs = new Map<string, ShellCachedOutput>()

const missing = new Map<string, true>()

/**
 * Follows one shell's output, polling while it runs and reading its final output once it stops. `setRunning` keeps the
 * read in flight, so a late running-shell inventory does not drop it.
 */
export function createShellFollower(input: {
  id: string
  directory: string
  running: boolean
  load: (input: ShellOutputInput) => Promise<ShellOutputOutput>
  onOutput: (output: string) => void
}) {
  const cached = outputs.get(input.id)

  if (cached) remember(outputs, input.id, cached, 32)
  const initial = createShellFollowerState({ cached, missing: missing.has(input.id), running: input.running })
  let state = initial.state
  let timer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: ShellFollowerEvent) => {
    const next = transitionShellFollower(state, event)
    state = next.state
    next.effects.forEach(run)
  }

  const run = (effect: ShellFollowerEffect) => {
    if (effect.type === "emit") return input.onOutput(effect.output)

    if (effect.type === "cache") {
      remember(outputs, input.id, { cursor: effect.cursor, output: effect.output, complete: effect.complete }, 32)

      return
    }

    if (effect.type === "cache-missing") return remember(missing, input.id, true, 512)
    clearTimeout(timer)
    timer = undefined

    if (effect.type === "cancel") return

    if (effect.type === "wait") {
      timer = setTimeout(() => dispatch({ type: "wait.elapsed", attempt: effect.attempt }), effect.delayMs)

      return
    }

    const attempt = effect.attempt
    timer = setTimeout(() => dispatch({ type: "read.failed", attempt }), SHELL_READ_TIMEOUT_MS)
    void input.load({ id: input.id, location: { directory: input.directory }, cursor: effect.cursor }).then(
      (response) => dispatch({ type: "read.succeeded", attempt, page: response.data }),
      (cause: unknown) => dispatch({ type: isShellNotFoundError(cause) ? "read.missing" : "read.failed", attempt }),
    )
  }

  initial.effects.forEach(run)

  return {
    setRunning: (running: boolean) => dispatch({ type: "running.changed", running }),
    dispose: () => dispatch({ type: "disposed" }),
  }
}

export function followShellOutput(input: Parameters<typeof createShellFollower>[0]) {
  return createShellFollower(input).dispose
}

function remember<T>(cache: Map<string, T>, id: string, entry: T, limit: number) {
  cache.delete(id)
  cache.set(id, entry)

  if (cache.size <= limit) return
  const oldest = cache.keys().next().value

  if (oldest !== undefined) cache.delete(oldest)
}
