import { describe, expect, test } from "bun:test"
import { oaCompatHelper } from "../src/routes/zen/util/provider/openai-compatible"
import { openaiHelper } from "../src/routes/zen/util/provider/openai"

const helper = (h: ReturnType<typeof oaCompatHelper>) => h
const ctx = { reqModel: "kimi-k2.6", providerModel: "moonshotai/kimi-k2.6-20260420" }

describe("oaCompatHelper.normalizeUsage (#24268)", () => {
  test("subtracts reasoning_tokens from completion_tokens so billing does not double-count", () => {
    const h = helper(oaCompatHelper(ctx))

    const usage = {
      prompt_tokens: 22,
      completion_tokens: 1226,
      total_tokens: 1248,
      completion_tokens_details: { reasoning_tokens: 790 },
    }

    const result = h.normalizeUsage(usage)

    expect(result.outputTokens).toBe(436)
    expect(result.reasoningTokens).toBe(790)
    expect(result.outputTokens + (result.reasoningTokens ?? 0)).toBe(1226)
  })

  test("clamps reasoning to completion when reasoning_tokens > completion_tokens (reporter's 'Hi' example)", () => {
    const h = helper(oaCompatHelper(ctx))

    const usage = {
      prompt_tokens: 22,
      completion_tokens: 77,
      total_tokens: 99,
      completion_tokens_details: { reasoning_tokens: 78 },
    }

    const result = h.normalizeUsage(usage)

    // outputTokens floors at 0; reasoningTokens is clamped to completion_tokens so the
    // invariant `outputTokens + reasoningTokens === completion_tokens` holds and we bill
    // exactly what the upstream API billed (no over-charge of the extra reasoning unit).
    expect(result.outputTokens).toBe(0)
    expect(result.reasoningTokens).toBe(77)
    expect(result.outputTokens + (result.reasoningTokens ?? 0)).toBe(77)
  })

  test("leaves outputTokens unchanged when no reasoning_tokens are reported", () => {
    const h = helper(oaCompatHelper(ctx))

    const usage = {
      prompt_tokens: 22,
      completion_tokens: 77,
      total_tokens: 99,
    }

    const result = h.normalizeUsage(usage)

    expect(result.outputTokens).toBe(77)
    expect(result.reasoningTokens).toBeUndefined()
  })

  test("matches OpenAI Responses helper convention for the same logical usage", () => {
    const compat = helper(oaCompatHelper(ctx))
    const responses = openaiHelper(ctx)

    const compatResult = compat.normalizeUsage({
      prompt_tokens: 22,
      completion_tokens: 1226,
      completion_tokens_details: { reasoning_tokens: 790 },
    })
    const responsesResult = responses.normalizeUsage({
      input_tokens: 22,
      output_tokens: 1226,
      output_tokens_details: { reasoning_tokens: 790 },
    })

    expect(compatResult.outputTokens).toBe(responsesResult.outputTokens)
    expect(compatResult.reasoningTokens).toBe(responsesResult.reasoningTokens)
    expect(compatResult.inputTokens).toBe(responsesResult.inputTokens)
  })
})
