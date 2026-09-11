import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { GoUpsellState } from "./usage-exceeded-dialogs"
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
