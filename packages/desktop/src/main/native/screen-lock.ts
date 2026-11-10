import { powerMonitor } from "electron"
import type { ScreenLock } from "@opencode/plugin/gui/builtin"
import {
  initialScreenLockState,
  isScreenLocked,
  transitionScreenLock,
  type ScreenLockEvent,
} from "./screen-lock-machine"

// Linux uses logind/elogind for lock edges when present, and the idle state otherwise; elsewhere the timer only catches
// a missed event. A cold start while already locked has no lock edge to observe, so
// the first probe (and, on macOS, Electron's idle state) is the only chance to see it.
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

  const probeSoon = () => {
    setTimeout(() => apply({ type: "probed", idle: idle() }), 500).unref()
    setTimeout(() => apply({ type: "probed", idle: idle() }), 2_000).unref()
  }

  const start = () => {
    if (started) return
    started = true

    apply({ type: "probed", idle: idle() })
    probeSoon()
    powerMonitor.on("lock-screen", () => apply({ type: "screen", locked: true }))
    powerMonitor.on("unlock-screen", () => apply({ type: "screen", locked: false }))
    powerMonitor.on("user-did-resign-active", () => apply({ type: "session", active: false }))
    powerMonitor.on("user-did-become-active", () => apply({ type: "session", active: true }))
    powerMonitor.on("suspend", () => apply({ type: "suspended" }))
    powerMonitor.on("resume", () => {
      apply({ type: "resumed", idle: idle() })
      probeSoon()
    })
    setInterval(() => apply({ type: "probed", idle: idle() }), PROBE_MS).unref()

    // Best effort: a headless session, a missing D-Bus tool, or no login1 must not stop the idle probe already running.
    if (process.platform === "linux")
      void import("./linux-screen-lock")
        .then(({ watchLinuxScreenLock }) => watchLinuxScreenLock((locked) => apply({ type: "bus", locked })))
        .catch(() => undefined)
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
