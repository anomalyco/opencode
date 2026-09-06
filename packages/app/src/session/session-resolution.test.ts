import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createSessionResolution } from "./session-resolution"

function store() {
  const syncs = { session: 0, message: 0, pending: 0 }
  const sessions = {
    get: () => undefined,
    sync: () => {
      syncs.session++
      return Promise.resolve()
    },
    message: {
      sync: () => {
        syncs.message++
        return Promise.resolve()
      },
    },
    pending: {
      sync: () => {
        syncs.pending++
        return Promise.resolve()
      },
    },
  }
  return { syncs, sessions }
}

describe("session resolution", () => {
  test("waits for a route session ID", () => {
    createRoot((dispose) => {
      const input = store()
      const session = createSessionResolution(
        () => undefined,
        () => input.sessions,
      )

      expect(session()).toBeUndefined()
      expect(input.syncs).toEqual({ session: 0, message: 0, pending: 0 })
      dispose()
    })
  })

  test("starts the transcript and queued input reads with metadata", () => {
    createRoot((dispose) => {
      const input = store()
      createSessionResolution(
        () => "ses_open",
        () => input.sessions,
        { children: true },
      )
      expect(input.syncs).toEqual({ session: 1, message: 1, pending: 1 })
      dispose()
    })
  })
})
