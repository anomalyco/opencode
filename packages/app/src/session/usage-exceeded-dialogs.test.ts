import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { GoUpsellState, goLimitLink } from "./usage-exceeded-dialogs"
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

describe("Go limit link", () => {
  const body = (json: string) => ({
    type: "provider.go-limit",
    message: "OpenCode Go usage limit reached.",
    response: { body: json },
  })

  test("opens the Go settings of the workspace that hit the limit", () => {
    expect(
      goLimitLink(
        body(
          JSON.stringify({
            type: "error",
            error: { type: "GoUsageLimitError", message: "Go usage limit exceeded" },
            metadata: { workspace: "wrk_go_limit", limitName: "5 hour" },
          }),
        ),
      ),
    ).toBe("https://opencode.ai/console/wrk_go_limit/go")
  })

  test("falls back to the Console when the body has no workspace", () => {
    expect(goLimitLink(body(JSON.stringify({ error: { type: "GoUsageLimitError" } })))).toBe(
      "https://opencode.ai/console",
    )
    expect(goLimitLink({ type: "provider.go-limit", message: "limit", response: { body: "not json" } })).toBe(
      "https://opencode.ai/console",
    )
    expect(goLimitLink({ type: "provider.go-limit", message: "limit" })).toBe("https://opencode.ai/console")
  })
})
