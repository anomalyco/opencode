import { describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"

describe("plan_mode config", () => {
  test("config schema accepts plan_mode in experimental", () => {
    const result = Config.Info.safeParse({
      experimental: {
        plan_mode: true,
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.experimental?.plan_mode).toBe(true)
    }
  })

  test("config schema accepts plan_mode false", () => {
    const result = Config.Info.safeParse({
      experimental: {
        plan_mode: false,
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.experimental?.plan_mode).toBe(false)
    }
  })

  test("config schema allows omitting plan_mode", () => {
    const result = Config.Info.safeParse({
      experimental: {},
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.experimental?.plan_mode).toBeUndefined()
    }
  })

  test("config schema rejects non-boolean plan_mode", () => {
    const result = Config.Info.safeParse({
      experimental: {
        plan_mode: "yes",
      },
    })
    expect(result.success).toBe(false)
  })
})
