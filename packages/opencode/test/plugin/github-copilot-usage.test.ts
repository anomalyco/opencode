import { afterEach, expect, mock, test } from "bun:test"
import { CopilotUsage, UsageError } from "@/plugin/github-copilot/usage"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("requests usage from GitHub API with GitHub token", async () => {
  let url = ""
  let auth = ""

  globalThis.fetch = mock((input, init) => {
    url = String(input)
    auth = String((init?.headers as Record<string, string>)?.Authorization ?? "")
    return Promise.resolve(
      new Response(
        JSON.stringify({
          copilot_plan: "business",
          quota_reset_date: "2026-04-30",
          quota_snapshots: {
            premium_interactions: { entitlement: 300, remaining: 240, percent_remaining: 80, unlimited: false },
          },
        }),
        { status: 200 },
      ),
    )
  }) as unknown as typeof fetch

  const result = await CopilotUsage.get({ token: "ghu_test" })
  expect(url).toBe("https://api.github.com/copilot_internal/user")
  expect(auth).toBe("token ghu_test")
  expect(result.copilot_plan).toBe("business")
})

test("formats summary and raw output", () => {
  const usage = {
    copilot_plan: "pro",
    quota_reset_date: "2026-04-30",
    quota_snapshots: {
      premium_interactions: {
        entitlement: 300,
        remaining: 150,
        percent_remaining: 50,
        unlimited: false,
        overage_permitted: true,
        overage_count: 12,
      },
      chat: {
        entitlement: 1000,
        remaining: 850,
        percent_remaining: 85,
        unlimited: false,
        overage_permitted: false,
        overage_count: 0,
      },
      completions: {
        entitlement: 5000,
        remaining: 4200,
        percent_remaining: 84,
        unlimited: false,
        overage_permitted: false,
        overage_count: 0,
      },
    },
  }

  const text = CopilotUsage.format({ usage })
  expect(text).toContain("使用额度: 150")
  expect(text).toContain("剩余额度: 150")
  expect(text).toContain("总额度: 300")
  expect(text).toContain("刷新时间: 2026-04-30")

  const raw = CopilotUsage.format({ usage, raw: true })
  expect(raw).toContain("```json")
  expect(raw).toContain("\"copilot_plan\": \"pro\"")
})

test("formats unlimited quota as infinite", () => {
  const text = CopilotUsage.format({
    usage: {
      quota_reset_date: "2026-05-01",
      quota_snapshots: {
        chat: {
          entitlement: 0,
          remaining: 0,
          unlimited: true,
        },
      },
    },
  })
  expect(text).toContain("使用额度: -")
  expect(text).toContain("剩余额度: 无限")
  expect(text).toContain("总额度: 无限")
})

test("maps known errors to readable messages", () => {
  expect(CopilotUsage.explain(new UsageError("not_logged_in"))).toContain("未检测到")
  expect(CopilotUsage.explain(new UsageError("token_invalid"))).toContain("失效")
  expect(CopilotUsage.explain(new UsageError("forbidden"))).toContain("权限")
  expect(CopilotUsage.explain(new UsageError("not_found"))).toContain("未找到")
  expect(CopilotUsage.explain(new UsageError("request_failed", 502))).toContain("HTTP 502")
})
