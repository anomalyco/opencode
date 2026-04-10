import { describe, expect, test } from "bun:test"
import { isOverflow } from "../../src/session/overflow"
import { DEFAULT_CONTEXT_LIMIT } from "../../src/provider/constants"
import type { Provider } from "../../src/provider/provider"
import type { MessageV2 } from "../../src/session/message-v2"
import type { Config } from "../../src/config/config"

// mock model has limit.output=8192, so maxOutputTokens=8192
// usable = context - maxOutputTokens = context - 8192
// overflow when count >= usable

function makeInput(overrides: {
  contextLimit?: number
  inputLimit?: number
  tokens?: Partial<MessageV2.Assistant["tokens"]>
  autoCompaction?: boolean
}) {
  const context = overrides.contextLimit ?? 0
  return {
    cfg: {
      compaction: {
        auto: overrides.autoCompaction ?? true,
      },
    } as Config.Info,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
      ...overrides.tokens,
    } as MessageV2.Assistant["tokens"],
    model: {
      limit: {
        context,
        input: overrides.inputLimit,
        output: 8192,
      },
    } as Provider.Model,
  }
}

describe("isOverflow", () => {
  test("returns false when auto compaction is disabled", () => {
    const input = makeInput({ contextLimit: 128000, autoCompaction: false, tokens: { input: 200000 } })
    expect(isOverflow(input)).toBe(false)
  })

  test("returns false when token usage is below limit", () => {
    const input = makeInput({ contextLimit: 128000, tokens: { input: 50000 } })
    expect(isOverflow(input)).toBe(false)
  })

  test("returns true when token usage exceeds limit", () => {
    // usable = 128000 - 8192 = 119808, count = 120000
    const input = makeInput({ contextLimit: 128000, tokens: { input: 120000 } })
    expect(isOverflow(input)).toBe(true)
  })

  test("uses DEFAULT_CONTEXT_LIMIT when model limit.context is 0 instead of skipping detection", () => {
    // Before the fix: context=0 → return false (skip detection entirely)
    // After the fix: context=0 → use DEFAULT_CONTEXT_LIMIT (128000)
    // usable = 128000 - 8192 = 119808

    // Below default limit: count = 100000 < 119808
    const inputBelow = makeInput({ contextLimit: 0, tokens: { input: 100000 } })
    expect(isOverflow(inputBelow)).toBe(false)

    // Exceed default limit: count = 120000 >= 119808
    const inputAbove = makeInput({ contextLimit: 0, tokens: { input: 120000 } })
    expect(isOverflow(inputAbove)).toBe(true)
  })

  test("uses DEFAULT_CONTEXT_LIMIT when model limit.context is 0 with input limit", () => {
    // With inputLimit, usable = inputLimit - reserved
    // reserved = min(20000, 8192) = 8192
    // usable = 60000 - 8192 = 51808
    const input = makeInput({ contextLimit: 0, inputLimit: 60000, tokens: { input: 55000 } })
    expect(isOverflow(input)).toBe(true)
  })

  test("respects explicit limit.context over default", () => {
    // usable = 64000 - 8192 = 55808
    const inputAbove = makeInput({ contextLimit: 64000, tokens: { input: 60000 } })
    expect(isOverflow(inputAbove)).toBe(true)

    const inputBelow = makeInput({ contextLimit: 64000, tokens: { input: 30000 } })
    expect(isOverflow(inputBelow)).toBe(false)
  })
})
