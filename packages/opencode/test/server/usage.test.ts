import { describe, expect, mock, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Auth } from "../../src/auth"
import { Env } from "../../src/env"

describe("provider.usage.list", () => {
  test("returns provider availability statuses", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
          }),
        )
      },
    })

    const originalAuthGet = Auth.get
    Auth.get = mock(async () => undefined) as unknown as typeof Auth.get

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const app = Server.App()
          const response = await app.request(`/provider/usage?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)

          const body = (await response.json()) as {
            providers: Record<string, { status: string }>
          }
          expect(body.providers.antigravity.status).toBe("not_configured")
          expect(body.providers["gemini-cli"].status).toBe("not_configured")
          expect(body.providers["qwen-cli"].status).toBe("not_configured")
          expect(body.providers.claude.status).toBe("not_authenticated")
          expect(body.providers["nano-gpt"].status).toBe("not_configured")
          expect(body.providers.codex.status).toBe("not_authenticated")
        },
      })
    } finally {
      Auth.get = originalAuthGet
    }
  })

  test("maps provider usage data and ui modes", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            provider: {
              antigravity: {
                options: {
                  baseURL: "http://localhost:8000",
                  apiKey: "proxy-key",
                },
              },
              "gemini-cli": {
                options: {
                  baseURL: "http://localhost:8000",
                  apiKey: "proxy-key",
                },
              },
              "qwen-cli": {
                options: {
                  baseURL: "http://localhost:8000",
                  apiKey: "proxy-key",
                },
              },
            },
          }),
        )
      },
    })

    const originalFetch = globalThis.fetch
    const originalAuthGet = Auth.get
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString()

      if (url === "http://localhost:8000/v1/quota-stats?provider=antigravity") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              providers: {
                antigravity: {
                  quota_groups: {
                    claude: {
                      windows: { "5h": { total_used: 100, total_max: 200, remaining_pct: 50, reset_at: null } },
                    },
                    "g3-flash": {
                      windows: { "5h": { total_used: 20, total_max: 100, remaining_pct: 80, reset_at: 1767225600 } },
                    },
                    "g3-pro": {
                      windows: { "5h": { total_used: 5, total_max: 50, remaining_pct: 90, reset_at: null } },
                    },
                  },
                },
              },
            }),
            { status: 200 },
          ),
        )
      }

      if (url === "http://localhost:8000/v1/quota-stats?provider=gemini_cli") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              providers: {
                gemini_cli: {
                  quota_groups: {
                    pro: { windows: { daily: { total_used: 12, total_max: 120, remaining_pct: 90, reset_at: null } } },
                    "3-flash": {
                      windows: { daily: { total_used: 1, total_max: 100, remaining_pct: 99, reset_at: null } },
                    },
                  },
                },
              },
            }),
            { status: 200 },
          ),
        )
      }

      if (url === "http://localhost:8000/v1/quota-stats?provider=qwen_code") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              providers: {
                qwen_code: {
                  credential_count: 2,
                  quota_groups: {},
                  credentials: {
                    a: {
                      model_usage: {
                        "qwen_code/qwen3-coder-plus": {
                          windows: {
                            daily: { request_count: 300, limit: null, remaining: null, reset_at: 1767225600 },
                          },
                        },
                      },
                    },
                    b: {
                      model_usage: {
                        "qwen_code/qwen3-coder-plus": {
                          windows: {
                            daily: { request_count: 100, limit: null, remaining: null, reset_at: 1767225600 },
                          },
                        },
                      },
                    },
                  },
                },
              },
            }),
            { status: 200 },
          ),
        )
      }

      if (url === "https://api.anthropic.com/api/oauth/usage") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              five_hour: { utilization: 40, resets_at: "2026-01-01T00:00:00.000Z" },
              seven_day: { utilization: 25, resets_at: "2026-01-07T00:00:00.000Z" },
            }),
            { status: 200 },
          ),
        )
      }

      if (url === "https://nano-gpt.com/api/subscription/v1/usage") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              limits: { daily: 5000, monthly: 60000 },
              daily: { used: 5, remaining: 4995, percentUsed: 0.001, resetAt: 1738540800000 },
              monthly: { used: 45, remaining: 59955, percentUsed: 0.00075, resetAt: 1739404800000 },
            }),
            { status: 200 },
          ),
        )
      }

      if (url === "https://chatgpt.com/backend-api/codex/usage") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              plan_type: "plus",
              rate_limit: {
                allowed: true,
                limit_reached: false,
                primary_window: {
                  used_percent: 65,
                  limit_window_seconds: 18000,
                  reset_after_seconds: 5765,
                  reset_at: 1770510326,
                },
                secondary_window: {
                  used_percent: 57,
                  limit_window_seconds: 604800,
                  reset_after_seconds: 182965,
                  reset_at: 1770687526,
                },
              },
            }),
            { status: 200 },
          ),
        )
      }

      return originalFetch(input)
    }) as unknown as typeof fetch

    Auth.get = mock(async (providerID: string) => {
      if (providerID === "anthropic") {
        return {
          type: "oauth" as const,
          access: "access-token",
          refresh: "refresh-token",
          expires: Date.now() + 60_000,
        }
      }
      if (providerID === "openai") {
        return {
          type: "oauth" as const,
          access: "openai-access-token",
          refresh: "openai-refresh-token",
          expires: Date.now() + 60_000,
          accountId: "account-123",
        }
      }
      return undefined
    }) as unknown as typeof Auth.get

    try {
      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          Env.set("NANO_GPT_API_KEY", "nano-key")
        },
        fn: async () => {
          const app = Server.App()
          const response = await app.request(`/provider/usage?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)

          const body = (await response.json()) as {
            providers: Record<
              string,
              {
                status: string
                ui: { mode: string }
                groups?: Array<{ name: string; used: number; max: number; remaining: number }>
              }
            >
          }

          expect(body.providers.antigravity.status).toBe("success")
          expect(body.providers.antigravity.ui.mode).toBe("count_and_percent")
          expect(body.providers.antigravity.groups?.map((group) => group.name)).toEqual([
            "claude",
            "g3-flash",
            "g3-pro",
          ])

          expect(body.providers["gemini-cli"].status).toBe("success")
          expect(body.providers["gemini-cli"].ui.mode).toBe("count_and_percent")
          expect(body.providers["gemini-cli"].groups?.map((group) => group.name)).toEqual(["pro", "3-flash"])

          expect(body.providers["qwen-cli"].status).toBe("success")
          expect(body.providers["qwen-cli"].ui.mode).toBe("count_and_percent")
          expect(body.providers["qwen-cli"].groups?.map((group) => group.name)).toEqual(["qwen3-coder-plus"])
          expect(body.providers["qwen-cli"].groups?.[0]?.used).toBe(400)
          expect(body.providers["qwen-cli"].groups?.[0]?.max).toBe(4000)
          expect(body.providers["qwen-cli"].groups?.[0]?.remaining).toBe(90)

          expect(body.providers.claude.status).toBe("success")
          expect(body.providers.claude.ui.mode).toBe("percent_only")
          expect(body.providers.claude.groups?.map((group) => group.name)).toEqual(["five_hour", "seven_day"])

          expect(body.providers["nano-gpt"].status).toBe("success")
          expect(body.providers["nano-gpt"].ui.mode).toBe("count_and_percent")
          expect(body.providers["nano-gpt"].groups?.map((group) => group.name)).toEqual(["daily", "monthly"])

          expect(body.providers.codex.status).toBe("success")
          expect(body.providers.codex.ui.mode).toBe("percent_only")
          expect(body.providers.codex.groups?.map((group) => group.name)).toEqual([
            "primary_window",
            "secondary_window",
          ])
          expect(body.providers.codex.groups?.[0]?.remaining).toBe(35)
          expect(body.providers.codex.groups?.[1]?.remaining).toBe(43)
        },
      })
    } finally {
      globalThis.fetch = originalFetch
      Auth.get = originalAuthGet
    }
  })

  test("returns per-provider errors without failing full payload", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            provider: {
              antigravity: {
                options: {
                  baseURL: "http://localhost:8000",
                  apiKey: "proxy-key",
                },
              },
            },
          }),
        )
      },
    })

    const originalFetch = globalThis.fetch
    const originalAuthGet = Auth.get
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url === "http://localhost:8000/v1/quota-stats?provider=antigravity") {
        return Promise.resolve(new Response("proxy unavailable", { status: 503 }))
      }
      return originalFetch(input)
    }) as unknown as typeof fetch
    Auth.get = mock(async () => undefined) as unknown as typeof Auth.get

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const app = Server.App()
          const response = await app.request(`/provider/usage?directory=${encodeURIComponent(tmp.path)}`)
          expect(response.status).toBe(200)

          const body = (await response.json()) as {
            providers: Record<string, { status: string; message?: string }>
          }

          expect(body.providers.antigravity.status).toBe("error")
          expect(body.providers.antigravity.message).toContain("proxy unavailable")

          expect(body.providers["gemini-cli"].status).toBe("not_configured")
          expect(body.providers["qwen-cli"].status).toBe("not_configured")
          expect(body.providers.claude.status).toBe("not_authenticated")
          expect(body.providers["nano-gpt"].status).toBe("not_configured")
          expect(body.providers.codex.status).toBe("not_authenticated")
        },
      })
    } finally {
      globalThis.fetch = originalFetch
      Auth.get = originalAuthGet
    }
  })
})
