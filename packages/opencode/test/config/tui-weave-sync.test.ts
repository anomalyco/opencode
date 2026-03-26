import { describe, expect, test } from "bun:test"
import { fetchWeaveState, getWeaveMethod } from "../../src/cli/cmd/tui/context/weave-sync"

describe("tui weave sync fallback", () => {
  test("returns undefined when weave method is unavailable", async () => {
    expect(getWeaveMethod({ session: {} })).toBeUndefined()
    const state = await fetchWeaveState({ session: {} }, "ses_missing")
    expect(state).toBeUndefined()
  })

  test("returns undefined when weave method throws", async () => {
    const client = {
      session: {
        weave: async () => {
          throw new Error("endpoint unavailable")
        },
      },
    }
    const state = await fetchWeaveState(client, "ses_any")
    expect(state).toBeUndefined()
  })
})
