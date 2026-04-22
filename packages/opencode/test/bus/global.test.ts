import { describe, expect, test } from "bun:test"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"

describe("GlobalBus", () => {
  test("does not warn for normal fanout subscriber counts", async () => {
    const warnings: Error[] = []
    const onWarning = (warning: Error) => {
      warnings.push(warning)
    }
    const handlers = Array.from({ length: 25 }, () => {
      return (_event: GlobalEvent) => {}
    })

    process.on("warning", onWarning)

    try {
      handlers.forEach((handler) => {
        GlobalBus.on("event", handler)
      })
      await Bun.sleep(0)
      expect(warnings).toHaveLength(0)
    } finally {
      handlers.forEach((handler) => {
        GlobalBus.off("event", handler)
      })
      process.off("warning", onWarning)
    }
  })
})
