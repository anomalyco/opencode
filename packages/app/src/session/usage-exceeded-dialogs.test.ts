import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { GoUpsellState, isChatGPTUsageLimit } from "./usage-exceeded-dialogs"
import { Persistence } from "@/runtime/persistence/schema"

const decode = Schema.decodeUnknownSync(
  Persistence.withInitial(GoUpsellState, {
    go_upsell_last_seen_at: null,
    go_upsell_dont_show: null,
    go_upsell_account_rate_limit_last_seen_at: null,
    go_upsell_account_rate_limit_dont_show: null,
  }),
)

describe("usage exceeded preferences", () => {
  test("defaults unseen prompts", () => {
    expect(decode({})).toEqual({
      go_upsell_last_seen_at: null,
      go_upsell_dont_show: null,
      go_upsell_account_rate_limit_last_seen_at: null,
      go_upsell_account_rate_limit_dont_show: null,
    })
  })

  test("preserves timestamps while recovering malformed siblings", () => {
    expect(
      decode({
        go_upsell_last_seen_at: 123,
        go_upsell_dont_show: "true",
        go_upsell_account_rate_limit_last_seen_at: Infinity,
        go_upsell_account_rate_limit_dont_show: 456,
      }),
    ).toEqual({
      go_upsell_last_seen_at: 123,
      go_upsell_dont_show: null,
      go_upsell_account_rate_limit_last_seen_at: null,
      go_upsell_account_rate_limit_dont_show: 456,
    })
  })
})

describe("ChatGPT usage limit", () => {
  test("detects the exact code in HTTP and streaming failures", () => {
    expect(
      isChatGPTUsageLimit({
        type: "provider.rate-limit",
        message: "ChatGPT usage limit reached",
        status: 429,
        response: { body: '{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}' },
      }),
    ).toBe(true)
    expect(
      isChatGPTUsageLimit({
        type: "provider.rate-limit",
        message: "ChatGPT usage limit reached",
        response: {
          body: '{"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}',
        },
      }),
    ).toBe(true)
  })

  test("ignores unrelated rate limits, text matches, and malformed bodies", () => {
    expect(
      isChatGPTUsageLimit({ type: "provider.rate-limit", message: "ChatGPT usage limit reached", status: 429 }),
    ).toBe(false)
    expect(
      isChatGPTUsageLimit({
        type: "provider.rate-limit",
        message: "Rate limit exceeded",
        status: 429,
        response: { body: '{"error":{"code":"rate_limit_exceeded"}}' },
      }),
    ).toBe(false)
    expect(
      isChatGPTUsageLimit({
        type: "provider.unknown",
        message: "subscription_sharing_usage_limit_exceeded",
        response: { body: "not JSON" },
      }),
    ).toBe(false)
  })
})
