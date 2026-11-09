import { powerMonitor } from "electron"
import type { ScreenLock } from "@opencode/plugin/gui/builtin"
import {
  initialScreenLockState,
  isScreenLocked,
  transitionScreenLock,
  type ScreenLockEvent,
} from "./screen-lock-machine"

// Linux has no lock events, so the idle state is read on a timer; elsewhere the timer only catches a missed event.
const PROBE_MS = 5_000

let shared: ScreenLock | undefined

/** The app's one screen lock monitor, started on first use, once the app is ready. */
export function screenLock(): ScreenLock {
  return (shared ??= createScreenLock())
}

function createScreenLock(): ScreenLock {
  const listeners = new Set<(locked: boolean) => void>()
  let state = initialScreenLockState
  let started = false

  // The threshold only separates `active` from `idle`, which both mean unlocked here. A platform that cannot answer
  // reports `unknown`, which changes nothing.
  const idle = (): ReturnType<typeof powerMonitor.getSystemIdleState> => {
    try {
      return powerMonitor.getSystemIdleState(60)
    } catch {
      return "unknown"
    }
  }

  const apply = (event: ScreenLockEvent) => {
    const before = isScreenLocked(state)
    state = transitionScreenLock(state, event)
    const after = isScreenLocked(state)

    if (before !== after) listeners.forEach((listener) => listener(after))
  }

  const start = () => {
    if (started) return
    started = true

    apply({ type: "probed", idle: idle() })
    powerMonitor.on("lock-screen", () => apply({ type: "screen", locked: true }))
    powerMonitor.on("unlock-screen", () => apply({ type: "screen", locked: false }))
    powerMonitor.on("user-did-resign-active", () => apply({ type: "session", active: false }))
    powerMonitor.on("user-did-become-active", () => apply({ type: "session", active: true }))
    powerMonitor.on("suspend", () => apply({ type: "suspended" }))
    powerMonitor.on("resume", () => apply({ type: "resumed", idle: idle() }))
    setInterval(() => apply({ type: "probed", idle: idle() }), PROBE_MS).unref()
  }

  return {
    locked() {
      start()

      return isScreenLocked(state)
    },
    on(listener) {
      start()
      listeners.add(listener)

      return () => void listeners.delete(listener)
    },
  }
}
