import { createSignal, onCleanup, untrack } from "solid-js"
import type { Bridge } from "@opencode/plugin/gui/host"
import {
  createStartupGateState,
  transitionStartupGate,
  type StartupGateEffect,
  type StartupGateEvent,
  type StartupGateTimer,
} from "./machine"

// How long the window waits for each phase before it shows anyway. Servers wait longest: listing WSL distributions
// can take many seconds.
const timeouts: Record<StartupGateTimer, number> = { preferences: 5_000, activation: 10_000, servers: 20_000 }

/**
 * Runs the startup gate for the owner's lifetime: asks main for the enable settings, keeps them current as main pushes
 * changes, and runs the gate's timers. Callers report what the gate waits for through `dispatch`.
 */
export function createStartupGate(input: {
  readonly bridge: Bridge | undefined
  /** The plugins activation waits for. */
  readonly plugins: readonly string[]
  /** Startup also waits for the contributed servers. */
  readonly servers: boolean
}) {
  const bridge = input.bridge

  const initial = createStartupGateState({
    bridge: !!bridge,
    preload: !!bridge?.manager.initial,
    plugins: input.plugins,
    servers: input.servers,
  })

  const [state, setState] = createSignal(initial.state)
  // Replies and timers that land after the owner is gone change nothing.
  const lifetime = { disposed: false }
  // The running phase timer; there is at most one.
  const timers = new Set<ReturnType<typeof setTimeout>>()
  // Events a transition's own state change raises (a plugin settling as the gate opens) wait behind its effects.
  const queue: StartupGateEvent[] = []

  const drain = () => {
    const event = queue[0]

    if (!event) return

    const next = transitionStartupGate(untrack(state), event)

    setState(next.state)
    next.effects.forEach(run)
    queue.shift()
    drain()
  }

  const dispatch = (event: StartupGateEvent) => {
    if (lifetime.disposed) return

    queue.push(event)

    if (queue.length === 1) drain()
  }

  const run = (effect: StartupGateEffect) => {
    if (effect.type === "preload.read")
      return void bridge?.manager.initial?.then(
        (rows) => dispatch(rows ? { type: "preload.resolved", rows } : { type: "preload.unavailable" }),
        () => dispatch({ type: "preload.unavailable" }),
      )

    if (effect.type === "list.fetch")
      return void Promise.try(() => bridge?.manager.list() ?? []).then(
        (list) => dispatch({ type: "list.resolved", list }),
        (cause: unknown) => {
          console.error("[plugin] failed to load installed plugin list", cause)
          dispatch({ type: "list.failed", error: cause instanceof Error ? cause.message : String(cause) })
        },
      )

    stopTimers()

    if (effect.type === "timer.start")
      timers.add(setTimeout(() => dispatch({ type: "timeout", timer: effect.timer }), timeouts[effect.timer]))
  }

  const stopTimers = () => {
    timers.forEach(clearTimeout)
    timers.clear()
  }

  if (bridge)
    onCleanup(
      bridge.on((message) => {
        if (message.type === "installed") dispatch({ type: "installed.pushed", list: message.list })
      }),
    )

  onCleanup(() => {
    lifetime.disposed = true
    stopTimers()
    queue.length = 0
  })

  initial.effects.forEach(run)

  return { state, dispatch }
}
