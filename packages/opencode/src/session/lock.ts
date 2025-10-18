import z from "zod/v4"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { NamedError } from "../util/error"

export namespace SessionLock {
  const log = Log.create({ service: "session.lock" })

  export const LockedError = NamedError.create(
    "SessionLockedError",
    z.object({
      sessionID: z.string(),
      message: z.string(),
    }),
  )

  type LockState = {
    controller: AbortController
    created: number
  }

  const state = Instance.state(
    () => {
      const locks = new Map<string, LockState>()
      return {
        locks,
      }
    },
    async (current) => {
      for (const [sessionID, lock] of current.locks) {
        log.info("force abort", { sessionID })
        lock.controller.abort()
      }
      current.locks.clear()
    },
  )

  function get(sessionID: string) {
    return state().locks.get(sessionID)
  }

  function unset(input: { sessionID: string; controller: AbortController }) {
    const lock = get(input.sessionID)
    if (!lock) return false
    if (lock.controller !== input.controller) return false
    state().locks.delete(input.sessionID)
    return true
  }

  export function acquire(input: { sessionID: string }) {
    const lock = get(input.sessionID)
    if (lock) {
      throw new LockedError({ sessionID: input.sessionID, message: `Session ${input.sessionID} is locked` })
    }
    const controller = new AbortController()
    state().locks.set(input.sessionID, {
      controller,
      created: Date.now(),
    })
    log.info("locked", { sessionID: input.sessionID })
    return {
      signal: controller.signal,
      abort() {
        controller.abort()
        unset({ sessionID: input.sessionID, controller })
      },
      async [Symbol.dispose]() {
        const removed = unset({ sessionID: input.sessionID, controller })
        if (removed) {
          log.info("unlocked", { sessionID: input.sessionID })
        }
      },
    }
  }

  export function abort(sessionID: string) {
    const lock = get(sessionID)
    if (!lock) return false
    log.info("abort", { sessionID })
    lock.controller.abort()
    state().locks.delete(sessionID)
    return true
  }

  export function isLocked(sessionID: string) {
    return get(sessionID) !== undefined
  }

  export function assertUnlocked(sessionID: string) {
    const lock = get(sessionID)
    if (!lock) return
    throw new LockedError({ sessionID, message: `Session ${sessionID} is locked` })
  }
}
