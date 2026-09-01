import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createSessionResolution } from "./session-resolution"

describe("session resolution", () => {
  test("waits for a route session ID", () => {
    createRoot((dispose) => {
      const syncs = { session: 0, message: 0 }
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
      }
      const session = createSessionResolution(
        () => undefined,
        () => sessions,
      )

      expect(session()).toBeUndefined()
      expect(syncs).toEqual({ session: 0, message: 0 })
      dispose()
    })
  })
})
