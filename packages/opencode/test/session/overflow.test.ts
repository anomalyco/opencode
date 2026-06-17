import { describe, expect, test } from "bun:test"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { isOverflow, tokenCount, usable } from "../../src/session/overflow"
import type { Provider } from "@/provider/provider"

const cfg = {} as ConfigV1.Info

function model(overrides: Partial<Provider.Model["limit"]> & { context: number }) {
  return {
    limit: {
      output: overrides.output ?? 32_000,
      input: overrides.input,
      context: overrides.context,
    },
  } as Provider.Model
}

describe("session.overflow", () => {
  test("tokenCount prefers positive total when it exceeds components", () => {
    expect(
      tokenCount({
        input: 1,
        output: 2,
        reasoning: 0,
        cache: { read: 3, write: 4 },
        total: 100,
      }),
    ).toBe(100)
  })

  test("tokenCount uses component sum when total undercounts", () => {
    expect(
      tokenCount({
        input: 50,
        output: 20,
        reasoning: 0,
        cache: { read: 10, write: 5 },
        total: 60,
      }),
    ).toBe(85)
  })

  test("tokenCount sums components when total is zero", () => {
    expect(
      tokenCount({
        input: 1,
        output: 2,
        reasoning: 0,
        cache: { read: 3, write: 4 },
        total: 0,
      }),
    ).toBe(10)
  })

  test("usable reserves output headroom for limit.input models", () => {
    const withInput = usable({ cfg, model: model({ context: 200_000, input: 200_000, output: 32_000 }) })
    const withoutInput = usable({ cfg, model: model({ context: 200_000, output: 32_000 }) })
    expect(withInput).toBe(168_000)
    expect(withoutInput).toBe(168_000)
  })

  test("isOverflow agrees for equivalent limit.input and context-only models", () => {
    const tokens = { input: 166_000, output: 10_000, reasoning: 0, cache: { read: 5_000, write: 0 } }
    const withInput = isOverflow({
      cfg,
      tokens,
      model: model({ context: 200_000, input: 200_000, output: 32_000 }),
    })
    const withoutInput = isOverflow({
      cfg,
      tokens,
      model: model({ context: 200_000, output: 32_000 }),
    })
    expect(withInput).toBe(true)
    expect(withoutInput).toBe(true)
  })
})
