import {
  initialWriteBehindState,
  isWriteBehindClosed,
  selectPendingRows,
  transitionWriteBehind,
  type WriteBehindCommand,
  type WriteBehindEvent,
} from "./write-behind-machine"

// Coalesces a burst of writes into one batch. The latest value per key wins, so a store that
// re-serializes on every mutation costs one row write per flush instead of one per change.
export function createWriteBehind<T>(input: {
  delay: number
  write: (batch: Map<string, T>) => void
  onError?: (cause: unknown) => void
}) {
  const current = { state: initialWriteBehindState<T>() }
  // The running flush timer; there is at most one.
  const timers = new Set<ReturnType<typeof setTimeout>>()

  const dispatch = (event: WriteBehindEvent<T>) => {
    const next = transitionWriteBehind(current.state, event, input.delay)
    current.state = next.state
    next.commands.forEach(perform)
  }

  const perform = (command: WriteBehindCommand<T>) => {
    if (command.type === "write") return dispatch(write(command.attempt, command.batch))

    if (command.type === "report-error") {
      if (!input.onError) throw command.error

      return input.onError(command.error)
    }

    if (command.type === "reject-closed") throw new Error("Write-behind buffer is closed")

    timers.forEach(clearTimeout)
    timers.clear()

    if (command.type === "start-timer")
      timers.add(setTimeout(() => dispatch({ type: "timer.fired", attempt: command.attempt }), command.delayMs))
  }

  // The write is the store's own SQLite transaction; a failure is a result the machine retries, not a crash.
  const write = (attempt: number, batch: Map<string, T>): WriteBehindEvent<T> => {
    try {
      input.write(batch)

      return { type: "write.succeeded", attempt }
    } catch (error) {
      return { type: "write.failed", attempt, error }
    }
  }

  return {
    get: (key: string) => selectPendingRows(current.state).get(key),
    has: (key: string) => selectPendingRows(current.state).has(key),
    entries: () => selectPendingRows(current.state).values(),
    /** Refuses new rows once closing, so a caller never acknowledges a write that will not happen. */
    closed: () => isWriteBehindClosed(current.state),
    set: (key: string, value: T) => dispatch({ type: "set", key, value }),
    drop: (predicate: (value: T) => boolean) => dispatch({ type: "drop", predicate }),
    flush: () => dispatch({ type: "flush.requested" }),
    close: () => dispatch({ type: "close.requested" }),
  }
}
