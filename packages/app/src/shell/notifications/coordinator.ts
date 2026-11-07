import { onCleanup } from "solid-js"
import { Predicate } from "effect"
import { INITIAL_FOCUS_LOCK_STATE, transitionFocusLock, type FocusLockEvent } from "./focus-lock-machine"

const FOCUS_LOCK = "opencode:notification-focus"

const DELIVERY_LOCK = "opencode:notification-delivery"

const MAX_CLAIMED = 500

export function createNotificationCoordinator() {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks

  const claimed = new Set<string>()

  if (typeof window !== "undefined" && locks) {
    let focusState = INITIAL_FOCUS_LOCK_STATE
    const releases = new Map<number, VoidFunction>()

    const dispatch = (event: FocusLockEvent) => {
      const next = transitionFocusLock(focusState, event)
      focusState = next.state
      next.effects.forEach((effect) => {
        const attempt = effect.attempt

        if (effect.type === "lock.release") {
          releases.get(attempt)?.()
          releases.delete(attempt)

          return
        }

        // A shared hold: every focused window keeps it, and an alert's exclusive request fails while any one does.
        locks
          .request(
            FOCUS_LOCK,
            { mode: "shared" },
            () =>
              new Promise<void>((resolve) => {
                releases.set(attempt, resolve)
                dispatch({ type: "lock.acquired", attempt })
              }),
          )
          .catch(() => {
            releases.delete(attempt)
            dispatch({ type: "lock.failed", attempt })
          })
      })
    }

    const syncFocus = () => dispatch({ type: "focus.changed", focused: document.hasFocus() })

    window.addEventListener("focus", syncFocus)
    window.addEventListener("blur", syncFocus)
    document.addEventListener("visibilitychange", syncFocus)
    syncFocus()
    onCleanup(() => {
      window.removeEventListener("focus", syncFocus)
      window.removeEventListener("blur", syncFocus)
      document.removeEventListener("visibilitychange", syncFocus)
      dispatch({ type: "disposed" })
    })
  }

  const once = async <T>(kind: "sound" | "system", eventID: string, run: () => Promise<T> | void) => {
    const key = `${kind}:${eventID}`

    const execute = async () => {
      if (!claim(kind, key, claimed)) return
      await run()
    }

    if (!locks) return execute()
    await locks.request(`opencode:notification:${key}`, execute)
  }

  return {
    sound<T>(eventID: string, run: () => Promise<T> | void) {
      return once("sound", eventID, run)
    },
    system<T>(eventID: string, run: () => Promise<T> | void) {
      return once("system", eventID, async () => {
        if (typeof document !== "undefined" && document.hasFocus()) return

        if (!locks) return run()
        // Another alert holding the focus lock must not look like a focused app window.
        await locks.request(DELIVERY_LOCK, () =>
          locks.request(FOCUS_LOCK, { mode: "exclusive", ifAvailable: true }, async (lock) => {
            if (!lock) return
            await run()
          }),
        )
      })
    },
  }
}

function claim(kind: "sound" | "system", eventID: string, claimed: Set<string>) {
  if (claimed.has(eventID)) return false

  if (typeof localStorage !== "undefined") {
    try {
      const storageKey = `opencode:notification-${kind}`
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]")
      const events = Array.isArray(value) ? value.filter(Predicate.isString) : []

      if (events.includes(eventID)) {
        claimed.add(eventID)

        return false
      }

      localStorage.setItem(storageKey, JSON.stringify([...events, eventID].slice(-MAX_CLAIMED)))
    } catch {
      // The in-memory claim still prevents duplicates in this renderer when storage is unavailable.
    }
  }

  claimed.add(eventID)

  return true
}
