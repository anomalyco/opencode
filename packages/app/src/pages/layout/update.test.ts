import { describe, expect, test } from "bun:test"
import { runUpdateAndRestart } from "./update"

describe("runUpdateAndRestart", () => {
  test("clears the installing state when restart resolves without exiting", async () => {
    const states: boolean[] = []
    await new Promise<void>((resolve) => {
      runUpdateAndRestart(
        async () => {},
        (installing) => {
          states.push(installing)
          if (states.length === 2) resolve()
        },
      )
    })

    expect(states).toEqual([true, false])
  })
})
