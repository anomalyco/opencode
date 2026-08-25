import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createSessionResolution } from "./session-resolution"

describe("session resolution", () => {
  test("waits for a route session ID", () => {
    createRoot((dispose) => {
      let syncs = 0
      const sessions = {
        get: () => undefined,
        sync: () => {
          syncs++
          return Promise.resolve()
        },
      }
      const session = createSessionResolution(() => undefined, () => sessions)

      expect(session()).toBeUndefined()
      expect(syncs).toBe(0)
      dispose()
    })
  })
})
