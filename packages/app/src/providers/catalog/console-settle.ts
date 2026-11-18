import { createEffect, createSignal, onCleanup, untrack } from "solid-js"
import {
  createConsoleSettleState,
  transitionConsoleSettle,
  type ConsoleSettleEffect,
  type ConsoleSettleEvent,
  type ConsoleSettleOutcome,
} from "./settle-machine"

// Polls the catalog until the Console workspace's providers load, the deadline passes, or the owner goes away.
export function createConsoleCatalogSettler(input: { isLoaded: () => boolean; sync: () => Promise<void> }) {
  const [settle, setSettle] = createSignal(createConsoleSettleState())
  const pending = new Map<number, (outcome: ConsoleSettleOutcome) => void>()
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: ConsoleSettleEvent) => {
    const result = transitionConsoleSettle(untrack(settle), event)
    setSettle(result.state)
    result.effects.forEach(run)
  }

  const run = (effect: ConsoleSettleEffect) => {
    if (effect.type === "poll.schedule") {
      clearTimeout(pollTimer)
      pollTimer = setTimeout(
        () => dispatch({ type: "poll.due", attempt: effect.attempt, loaded: input.isLoaded() }),
        effect.delayMs,
      )

      return
    }

    if (effect.type === "deadline.start") {
      clearTimeout(deadlineTimer)
      deadlineTimer = setTimeout(
        () => dispatch({ type: "timed-out", attempt: effect.attempt, loaded: input.isLoaded() }),
        effect.timeoutMs,
      )

      return
    }

    if (effect.type === "timers.stop") {
      clearTimeout(pollTimer)
      clearTimeout(deadlineTimer)
      pollTimer = undefined
      deadlineTimer = undefined

      return
    }

    // A failed read is just another miss: the next poll tries again until the deadline.
    if (effect.type === "sync") {
      void Promise.try(input.sync)
        .catch(() => undefined)
        .then(() => dispatch({ type: "sync.settled", attempt: effect.attempt, loaded: input.isLoaded() }))

      return
    }

    pending.get(effect.attempt)?.(effect.outcome)
    pending.delete(effect.attempt)
  }

  createEffect(() => {
    if (settle().status === "waiting" && input.isLoaded()) untrack(() => dispatch({ type: "catalog.loaded" }))
  })

  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    settle: () =>
      new Promise<ConsoleSettleOutcome>((resolve) => {
        pending.set(untrack(settle).attempt + 1, resolve)
        dispatch({ type: "started", loaded: untrack(input.isLoaded) })
      }),
    cancel: () => dispatch({ type: "cancelled" }),
  }
}
