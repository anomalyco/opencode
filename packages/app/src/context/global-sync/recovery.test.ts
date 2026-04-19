import { describe, expect, test } from "bun:test"
import { createRecoveryCoordinator } from "./recovery"

describe("createRecoveryCoordinator", () => {
  test("coalesces overlapping resume triggers", async () => {
    const calls: Array<{ reasons: string[]; force: boolean }> = []
    const recovery = createRecoveryCoordinator({
      delayMs: 0,
      run(input) {
        calls.push({ reasons: [...input.reasons], force: input.force })
      },
    })

    void recovery.trigger({ reason: "visibility" })
    void recovery.trigger({ reason: "focus", force: true })
    await recovery.flush()

    expect(calls).toEqual([{ reasons: ["visibility", "focus"], force: true }])
  })

  test("queues one more recovery while the previous run is active", async () => {
    const calls: string[][] = []
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const recovery = createRecoveryCoordinator({
      delayMs: 0,
      async run(input) {
        calls.push([...input.reasons])
        if (calls.length === 1) await gate
      },
    })

    void recovery.trigger({ reason: "visibility" })
    const first = recovery.flush()
    void recovery.trigger({ reason: "online" })
    release()
    await first
    await recovery.flush()

    expect(calls).toEqual([["visibility"], ["online"]])
  })
})
