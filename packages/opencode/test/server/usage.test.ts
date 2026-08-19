import { afterEach, describe, expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import type { Snapshot } from "../../src/usage/types"
import { fetchChatgptUsage } from "../../src/usage/providers/openai"
import { fetchClaudeUsage } from "../../src/usage/providers/anthropic"
import { fetchCopilotUsage } from "../../src/usage/providers/github-copilot"
import { Usage } from "../../src/usage/usage"
import type { Auth } from "../../src/auth"
import { Global } from "@opencode-ai/core/global"
import { Server } from "../../src/server/server"
import { iife } from "../../src/util/iife"
import { provideTestInstance } from "../fixture/fixture"

const app = Server.Default().app
const clearUsage = (provider: string) => {
  Usage.clearCache()
  return fs.rm(path.join(Global.Path.data, "storage", "usage", provider), {
    force: true,
    recursive: true,
  })
}

function windowByLabel(snapshot: Snapshot, label: string) {
  return snapshot.windows.find((window) => window.label === label)
}

type UsageApiResult = {
  provider: string
  displayName: string
  status: "ok" | "stale" | "unavailable" | "unauthenticated" | "unsupported"
  snapshot: Snapshot | null
  error?: {
    code: string
    message: string
    retryable: boolean
  }
}

type UsageApiBody = {
  results: UsageApiResult[]
}

async function usageBody(response: Response): Promise<UsageApiBody> {
  return (await response.json()) as UsageApiBody
}

function firstResult(body: UsageApiBody): UsageApiResult {
  const result = body.results[0]
  if (!result) throw new Error("Expected usage result")
  return result
}

function requireSnapshot(result: UsageApiResult): Snapshot {
  if (!result.snapshot) throw new Error("Expected usage snapshot")
  return result.snapshot
}

function authFile() {
  return path.join(Global.Path.data, "auth.json")
}

function antigravityAccountsFile() {
  return path.join(Global.Path.config, "antigravity-accounts.json")
}

function assertTestDataPath() {
  if (Global.Path.data.includes("opencode-test-data-")) return
  throw new Error(`Refusing to mutate non-test auth path: ${Global.Path.data}`)
}

async function writeAuthJson(entries: Record<string, Auth.Info>): Promise<void> {
  assertTestDataPath()
  await fs.mkdir(Global.Path.data, { recursive: true })
  await fs.writeFile(authFile(), JSON.stringify(entries), { mode: 0o600 })
}

async function writeAntigravityAccountsJson(content: unknown): Promise<void> {
  assertTestDataPath()
  await fs.mkdir(Global.Path.config, { recursive: true })
  await fs.writeFile(antigravityAccountsFile(), JSON.stringify(content), { mode: 0o600 })
}

async function clearAuthJson(): Promise<void> {
  assertTestDataPath()
  await fs.rm(authFile(), { force: true })
  await fs.rm(antigravityAccountsFile(), { force: true })
}

afterEach(async () => {
  Usage.clearCache()
  await clearAuthJson()
})
const authHeader = iife(() => {
  const password = process.env.OPENCODE_SERVER_PASSWORD
  if (!password) return null
  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
})

function request(path: string, init?: RequestInit) {
  return requestApp(app, path, init)
}

type RequestApp = {
  request: (path: string, init?: RequestInit) => Response | Promise<Response>
}

function requestApp(app: RequestApp, path: string, init?: RequestInit) {
  if (!authHeader) return app.request(path, init)
  const headers = new Headers(init?.headers ?? {})
  headers.set("Authorization", authHeader)
  return app.request(path, {
    ...init,
    headers,
  })
}

const openaiUsageResponse = {
  plan_type: "plus",
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 10,
      limit_window_seconds: 5 * 60 * 60,
      reset_after_seconds: 60,
      reset_at: 1_700_000_000,
    },
    secondary_window: {
      used_percent: 25,
      limit_window_seconds: 7 * 24 * 60 * 60,
      reset_after_seconds: 120,
      reset_at: 1_700_604_800,
    },
  },
  credits: {
    has_credits: true,
    unlimited: false,
    balance: "12.34",
  },
}

const openaiSpendControl = {
  reached: false,
  individual_limit: {
    source: "workspace",
    limit: "25000",
    used: "8000",
    remaining: "17000",
    used_percent: 32,
    remaining_percent: 68,
    reset_after_seconds: 3600,
    reset_at: 1_700_604_800,
  },
}

async function withInstance(run: () => Promise<void>) {
  await provideTestInstance({ directory: process.cwd(), fn: run })
}

describe("/usage", () => {
  test("returns openai usage with org header", async () => {
    const originalFetch = globalThis.fetch
    const accountId = "acct_123"
    const seen = { accountId: "" }

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString()
      if (url === "https://chatgpt.com/backend-api/wham/usage") {
        const headers = new Headers(init?.headers ?? {})
        seen.accountId = headers.get("ChatGPT-Account-Id") ?? ""
        return Promise.resolve(new Response(JSON.stringify(openaiUsageResponse), { status: 200 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      const result = await fetchChatgptUsage("codex-token", accountId)
      const snapshot = result.snapshot
      expect(snapshot ? windowByLabel(snapshot, "5h")?.usedPercent : undefined).toBe(10)
      expect(snapshot ? windowByLabel(snapshot, "Weekly")?.usedPercent : undefined).toBe(25)
      expect(seen.accountId).toBe(accountId)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  // OpenAI can disable a window at will; with the 5h window disabled the 7d
  // window arrives in primary_window. Labels must derive from the window
  // duration, not the slot position (live-observed shape).
  test("openai labels the weekly window when the 5h window is disabled", async () => {
    const originalFetch = globalThis.fetch

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://chatgpt.com/backend-api/wham/usage") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              plan_type: "plus",
              rate_limit: {
                allowed: true,
                limit_reached: false,
                primary_window: {
                  used_percent: 99,
                  limit_window_seconds: 604800,
                  reset_after_seconds: 553587,
                  reset_at: 1784487599,
                },
                secondary_window: null,
              },
              credits: null,
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      const result = await fetchChatgptUsage("codex-token")
      const snapshot = result.snapshot
      expect(snapshot?.windows).toHaveLength(1)
      expect(snapshot?.windows[0]).toMatchObject({
        id: "weekly",
        label: "Weekly",
        usedPercent: 99,
        windowMinutes: 10080,
        resetsAt: 1784487599,
      })
      expect(snapshot ? windowByLabel(snapshot, "5h") : undefined).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("openai drops windows without a positive duration", async () => {
    const originalFetch = globalThis.fetch

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://chatgpt.com/backend-api/wham/usage") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              plan_type: "plus",
              rate_limit: {
                allowed: true,
                limit_reached: false,
                primary_window: {
                  used_percent: 10,
                  limit_window_seconds: 0,
                  reset_after_seconds: 60,
                  reset_at: 1_700_000_000,
                },
                secondary_window: {
                  used_percent: 25,
                  limit_window_seconds: 7 * 24 * 60 * 60,
                  reset_after_seconds: 120,
                  reset_at: 1_700_604_800,
                },
              },
              credits: null,
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      const result = await fetchChatgptUsage("codex-token")
      expect(result.snapshot?.windows.map((window) => window.label)).toEqual(["Weekly"])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("openai preserves current plan variants", async () => {
    const originalFetch = globalThis.fetch
    const planTypes = [
      "prolite",
      "self_serve_business_prolite",
      "self_serve_business_usage_based",
      "ent26",
      "enterprise_cbp_automation",
      "enterprise_cbp_usage_based",
      "unknown",
    ] as const

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString() === "https://chatgpt.com/backend-api/wham/usage") {
        const planType = new Headers(init?.headers).get("Authorization")?.slice("Bearer ".length)
        return Promise.resolve(
          new Response(JSON.stringify({ ...openaiUsageResponse, plan_type: planType }), { status: 200 }),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      const results = await Promise.all(planTypes.map((planType) => fetchChatgptUsage(planType)))
      expect(results.map((result) => result.snapshot?.planType)).toEqual([...planTypes])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("openai maps additional rate limits and monthly spend control", async () => {
    const originalFetch = globalThis.fetch

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://chatgpt.com/backend-api/wham/usage") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              plan_type: "self_serve_business_usage_based",
              rate_limit: null,
              additional_rate_limits: [
                {
                  limit_name: "GPT-5.3-Codex",
                  metered_feature: "codex_other_models",
                  rate_limit: {
                    allowed: true,
                    limit_reached: false,
                    primary_window: {
                      used_percent: 35,
                      limit_window_seconds: 5 * 60 * 60,
                      reset_after_seconds: 60,
                      reset_at: 1_700_000_000,
                    },
                    secondary_window: {
                      used_percent: 45,
                      limit_window_seconds: 7 * 24 * 60 * 60,
                      reset_after_seconds: 120,
                      reset_at: 1_700_604_800,
                    },
                  },
                },
              ],
              spend_control: openaiSpendControl,
              credits: null,
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      const result = await fetchChatgptUsage("codex-token")
      expect(result.snapshot?.planType).toBe("self_serve_business_usage_based")
      expect(result.snapshot?.windows).toEqual([
        {
          id: "codex_other_models:5h",
          label: "GPT-5.3-Codex 5h",
          usedPercent: 35,
          windowMinutes: 300,
          resetsAt: 1_700_000_000,
        },
        {
          id: "codex_other_models:weekly",
          label: "GPT-5.3-Codex Weekly",
          usedPercent: 45,
          windowMinutes: 10_080,
          resetsAt: 1_700_604_800,
        },
        {
          id: "monthly-credit-limit",
          label: "Monthly Credit",
          usedPercent: 32,
          windowMinutes: null,
          resetsAt: 1_700_604_800,
        },
      ])
      expect(result.snapshot?.credits).toEqual({
        hasCredits: true,
        unlimited: false,
        balance: "17000",
        label: "Monthly Credit Limit",
        total: 25_000,
        used: 8_000,
        remaining: 17_000,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("openai preserves credit balance when spend control is also present", async () => {
    const originalFetch = globalThis.fetch

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://chatgpt.com/backend-api/wham/usage") {
        return Promise.resolve(
          new Response(JSON.stringify({ ...openaiUsageResponse, spend_control: openaiSpendControl }), { status: 200 }),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      const snapshot = (await fetchChatgptUsage("codex-token")).snapshot
      if (!snapshot) throw new Error("Expected usage snapshot")
      expect(snapshot.credits).toMatchObject({ label: "Credits Balance", balance: "12.34" })
      expect(windowByLabel(snapshot, "Monthly Credit")).toMatchObject({
        usedPercent: 32,
        resetsAt: 1_700_604_800,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("openai usage network errors do not write to console", async () => {
    const originalFetch = globalThis.fetch
    const warn = spyOn(console, "warn").mockImplementation(() => {})

    globalThis.fetch = (() => Promise.reject(new Error("The operation timed out."))) as unknown as typeof fetch

    try {
      const result = await fetchChatgptUsage("codex-token")
      expect(result.snapshot).toBeNull()
      expect(result.error?.message).toBe("OpenAI ChatGPT usage request failed (network)")
      expect(result.error?.kind).toBe("transient")
      expect(warn).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = originalFetch
      warn.mockRestore()
    }
  })

  test("refresh=false uses cache without calling fetch", async () => {
    const originalFetch = globalThis.fetch
    const calls = { count: 0 }

    await writeAuthJson({
      openai: {
        type: "oauth",
        access: "codex-token",
        refresh: "codex-refresh",
        expires: 0,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input.toString()
      if (url === "https://chatgpt.com/backend-api/wham/usage") {
        calls.count += 1
        return Promise.resolve(new Response(JSON.stringify(openaiUsageResponse), { status: 200 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("openai")
        const primed = await request("/usage?provider=openai&refresh=true")
        expect(primed.status).toBe(200)
        expect(calls.count).toBe(1)

        const response = await request("/usage?provider=openai&refresh=false")
        expect(response.status).toBe(200)
        const body = await usageBody(response)
        expect(body.results.length).toBe(1)
        expect(firstResult(body).status).toBe("ok")
        expect(requireSnapshot(firstResult(body)).planType).toBe("plus")
        expect(calls.count).toBe(1)
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("cached usage is scoped to the authenticated token", async () => {
    const originalFetch = globalThis.fetch
    const calls = { count: 0 }

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString()
      if (url === "https://chatgpt.com/backend-api/wham/usage") {
        calls.count += 1
        const headers = new Headers(init?.headers ?? {})
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ...openaiUsageResponse,
              plan_type: headers.get("Authorization") === "Bearer token-b" ? "pro" : "plus",
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("openai")
        await writeAuthJson({
          openai: {
            type: "oauth",
            access: "token-a",
            refresh: "refresh-a",
            expires: 0,
          },
        })

        const first = await request("/usage?provider=openai&refresh=false")
        expect(first.status).toBe(200)
        const firstBody = await usageBody(first)
        expect(requireSnapshot(firstResult(firstBody)).planType).toBe("plus")

        await writeAuthJson({
          openai: {
            type: "oauth",
            access: "token-b",
            refresh: "refresh-b",
            expires: 0,
          },
        })

        const second = await request("/usage?provider=openai&refresh=false")
        expect(second.status).toBe(200)
        const secondBody = await usageBody(second)
        expect(requireSnapshot(firstResult(secondBody)).planType).toBe("pro")
        expect(calls.count).toBe(2)
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  // Usage must never refresh inference credentials: a concurrent refresh from
  // the inference plugin against a rotating refresh token can revoke the grant.
  test("expired openai oauth is reported without refreshing credentials", async () => {
    const originalFetch = globalThis.fetch
    const calls = {
      token: 0,
      usage: 0,
    }

    await writeAuthJson({
      openai: {
        type: "oauth",
        access: "expired-token",
        refresh: "openai-refresh",
        expires: 1,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input.toString()
      if (url === "https://auth.openai.com/oauth/token") {
        calls.token += 1
        return Promise.resolve(new Response("", { status: 500 }))
      }
      if (url === "https://chatgpt.com/backend-api/wham/usage") {
        calls.usage += 1
        return Promise.resolve(new Response(JSON.stringify(openaiUsageResponse), { status: 200 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("openai")
        const response = await request("/usage?provider=openai&refresh=true")
        expect(response.status).toBe(200)
        const body = await usageBody(response)
        const result = firstResult(body)
        expect(result.provider).toBe("openai")
        expect(result.status).toBe("unauthenticated")
        expect(result.snapshot).toBeNull()
        expect(result.error?.code).toBe("reauth_required")
        expect(result.error?.retryable).toBe(false)
        expect(calls).toEqual({ token: 0, usage: 0 })

        const auth = JSON.parse(await fs.readFile(authFile(), "utf8")) as Record<string, Auth.Info>
        expect(auth.openai).toMatchObject({
          type: "oauth",
          access: "expired-token",
          refresh: "openai-refresh",
        })
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("usage route returns cached response shape", async () => {
    const originalFetch = globalThis.fetch
    await writeAuthJson({
      openai: {
        type: "oauth",
        access: "codex-token",
        refresh: "codex-refresh",
        expires: 0,
      },
    })
    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://chatgpt.com/backend-api/wham/usage") {
        return Promise.resolve(new Response(JSON.stringify(openaiUsageResponse), { status: 200 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("openai")
        const primed = await request("/usage?provider=openai&refresh=true")
        const primedBody = await primed.json()

        const response = await request("/usage?provider=openai&refresh=%20FALSE%20")
        const text = await response.text()
        if (response.status !== 200) throw new Error(text)
        expect(response.status).toBe(200)
        expect(JSON.parse(text)).toEqual(primedBody)
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("expired anthropic oauth is reported without refreshing credentials", async () => {
    const originalFetch = globalThis.fetch
    const calls = {
      token: 0,
      usage: 0,
    }
    await writeAuthJson({
      anthropic: {
        type: "oauth",
        access: "expired-claude-token",
        refresh: "claude-refresh",
        expires: 1,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input.toString()
      if (url === "https://platform.claude.com/v1/oauth/token") {
        calls.token += 1
        return Promise.resolve(new Response("", { status: 500 }))
      }
      if (url === "https://api.anthropic.com/api/oauth/usage") {
        calls.usage += 1
        return Promise.resolve(new Response("", { status: 500 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("anthropic")
        const response = await request("/usage?provider=anthropic&refresh=true")
        expect(response.status).toBe(200)
        const body = await usageBody(response)
        const result = firstResult(body)
        expect(result.provider).toBe("anthropic")
        expect(result.status).toBe("unauthenticated")
        expect(result.snapshot).toBeNull()
        expect(result.error?.code).toBe("reauth_required")
        expect(result.error?.message).toContain("opencode auth login")
        expect(calls).toEqual({ token: 0, usage: 0 })

        const auth = JSON.parse(await fs.readFile(authFile(), "utf8")) as Record<string, Auth.Info>
        expect(auth.anthropic).toMatchObject({
          type: "oauth",
          access: "expired-claude-token",
          refresh: "claude-refresh",
        })
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("missing auth suggests login command", async () => {
    await writeAuthJson({})

    await withInstance(async () => {
      const response = await request("/usage?provider=openai")
      expect(response.status).toBe(200)
      const body = await usageBody(response)
      const result = firstResult(body)
      expect(result.status).toBe("unauthenticated")
      expect(result.error?.code).toBe("missing_auth")
      expect(result.error?.message).toContain("opencode auth login")
      expect(result.error?.message).not.toContain("opencode auth add")
    })
  })

  test("anthropic API key auth reports OAuth usage requirement", async () => {
    await writeAuthJson({
      anthropic: {
        type: "api",
        key: "anthropic-api-key",
      },
    })

    await withInstance(async () => {
      const response = await request("/usage?provider=anthropic")
      expect(response.status).toBe(200)
      const body = await usageBody(response)
      const result = firstResult(body)
      expect(result.status).toBe("unauthenticated")
      expect(result.error?.code).toBe("missing_oauth")
      expect(result.error?.message).toContain("Claude usage requires Anthropic OAuth credentials")
      expect(result.error?.message).toContain("API key auth cannot access Claude usage")
      expect(result.error?.message).toContain("OAuth-capable Claude plugin")
    })
  })

  test("google API key auth reports Antigravity OAuth usage requirement", async () => {
    await writeAuthJson({
      google: {
        type: "api",
        key: "google-api-key",
      },
    })

    await withInstance(async () => {
      const response = await request("/usage?provider=google")
      expect(response.status).toBe(200)
      const body = await usageBody(response)
      const result = firstResult(body)
      expect(result.status).toBe("unauthenticated")
      expect(result.error?.code).toBe("missing_oauth")
      expect(result.error?.message).toContain("Google Antigravity usage requires OAuth credentials")
      expect(result.error?.message).toContain("API key auth cannot access Antigravity usage")
      expect(result.error?.message).toContain("OAuth-capable Antigravity auth plugin")
    })
  })

  test("Google Antigravity 401 during fetch reports reauth_required", async () => {
    const originalFetch = globalThis.fetch

    await writeAuthJson({
      google: {
        type: "oauth",
        access: "revoked-antigravity-token",
        refresh: "antigravity-refresh|project-123",
        expires: 0,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels") {
        return Promise.resolve(new Response("", { status: 401 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("google")
        const response = await request("/usage?provider=google&refresh=true")
        expect(response.status).toBe(200)
        const body = await usageBody(response)
        const result = firstResult(body)
        expect(result.status).toBe("unauthenticated")
        expect(result.snapshot).toBeNull()
        expect(result.error?.code).toBe("reauth_required")
        expect(result.error?.retryable).toBe(false)
        expect(result.error?.message).toContain("Google Antigravity credentials expired")
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("usage route reads Google Antigravity OAuth from auth json", async () => {
    const originalFetch = globalThis.fetch
    const calls = { quota: 0 }
    const reset = "2026-05-22T00:00:00.000Z"

    await writeAuthJson({
      google: {
        type: "oauth",
        access: "antigravity-token",
        refresh: "antigravity-refresh|project-123",
        expires: 0,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString()
      if (url === "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels") {
        calls.quota += 1
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer antigravity-token")
        expect(init?.body).toBe(JSON.stringify({ project: "project-123" }))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              models: {
                "claude-sonnet-4-6": {
                  quotaInfo: { remainingFraction: 0.25, resetTime: reset },
                },
                "gemini-3.1-pro-high": {
                  quotaInfo: { remainingFraction: 0.5, resetTime: reset },
                },
                "gemini-3.5-flash": {
                  quotaInfo: { remainingFraction: 0.8, resetTime: reset },
                },
              },
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("google")
        const response = await request("/usage?provider=google&refresh=true")
        expect(response.status).toBe(200)
        const body = await usageBody(response)
        const result = firstResult(body)
        const snapshot = requireSnapshot(result)
        expect(result.provider).toBe("google")
        expect(result.status).toBe("ok")
        expect(windowByLabel(snapshot, "Claude Opus")?.usedPercent).toBe(75)
        expect(windowByLabel(snapshot, "Gemini Pro")?.usedPercent).toBe(50)
        expect(windowByLabel(snapshot, "Gemini Flash")?.usedPercent).toBe(20)
        expect(windowByLabel(snapshot, "Claude Opus")?.resetsAt).toBe(Math.floor(Date.parse(reset) / 1000))
        expect(calls.quota).toBe(1)
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("Google Antigravity does not report missing live quota as exhausted", async () => {
    const originalFetch = globalThis.fetch

    await writeAuthJson({
      google: {
        type: "oauth",
        access: "antigravity-token",
        refresh: "antigravity-refresh|project-123",
        expires: 0,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              models: {
                "claude-sonnet-4-6": { quotaInfo: { resetTime: "2026-08-01T00:00:00.000Z" } },
              },
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("google")
        const response = await request("/usage?provider=google&refresh=true")
        expect(response.status).toBe(200)
        const result = firstResult(await usageBody(response))
        expect(result.status).toBe("unavailable")
        expect(result.snapshot).toBeNull()
        expect(result.error?.message).toContain("no quota information available")
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("Google Antigravity keeps quota and reset time from the same model", async () => {
    const originalFetch = globalThis.fetch
    const restrictiveReset = "2026-08-10T00:00:00.000Z"

    await writeAuthJson({
      google: {
        type: "oauth",
        access: "antigravity-token",
        refresh: "antigravity-refresh|project-123",
        expires: 0,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              models: {
                "claude-opus-restrictive": {
                  quotaInfo: { remainingFraction: 0.2, resetTime: restrictiveReset },
                },
                "claude-opus-sooner": {
                  quotaInfo: { remainingFraction: 0.8, resetTime: "2026-08-01T00:00:00.000Z" },
                },
              },
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("google")
        const response = await request("/usage?provider=google&refresh=true")
        const snapshot = requireSnapshot(firstResult(await usageBody(response)))
        expect(windowByLabel(snapshot, "Claude Opus")?.usedPercent).toBe(80)
        expect(windowByLabel(snapshot, "Claude Opus")?.resetsAt).toBe(
          Math.floor(new Date(restrictiveReset).getTime() / 1000),
        )
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("usage route reads Google Antigravity cached quota from account storage", async () => {
    const originalFetch = globalThis.fetch
    const resetMs = Date.now() + 6 * 24 * 60 * 60 * 1000
    const reset = new Date(resetMs).toISOString()
    const updatedAt = Date.now()
    let quotaCalls = 0

    await writeAuthJson({
      google: {
        type: "oauth",
        access: "",
        refresh: "antigravity-refresh|project-123|managed-456",
        expires: 0,
      },
    })
    await writeAntigravityAccountsJson({
      version: 4,
      activeIndex: 0,
      activeIndexByFamily: { claude: 0, gemini: 0 },
      accounts: [
        {
          email: "test@example.com",
          refreshToken: "antigravity-refresh",
          projectId: "project-123",
          managedProjectId: "managed-456",
          addedAt: 1,
          lastUsed: 1,
          cachedQuotaUpdatedAt: updatedAt,
          cachedQuota: {
            claude: { remainingFraction: 0.25, resetTime: reset, modelCount: 1 },
            "gemini-pro": { remainingFraction: 0.5, resetTime: reset, modelCount: 1 },
            "gemini-flash": { remainingFraction: 0.8, resetTime: reset, modelCount: 1 },
          },
        },
      ],
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels") {
        quotaCalls += 1
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("google")
        const response = await request("/usage?provider=google&refresh=true")
        expect(response.status).toBe(200)
        const body = await usageBody(response)
        const result = firstResult(body)
        const snapshot = requireSnapshot(result)
        expect(result.provider).toBe("google")
        expect(result.status).toBe("ok")
        expect(result.error).toBeUndefined()
        expect(windowByLabel(snapshot, "Claude Opus")?.usedPercent).toBe(75)
        expect(windowByLabel(snapshot, "Gemini Pro")?.usedPercent).toBe(50)
        expect(windowByLabel(snapshot, "Gemini Flash")?.usedPercent).toBe(20)
        expect(windowByLabel(snapshot, "Claude Opus")?.resetsAt).toBe(Math.floor(resetMs / 1000))
        expect(snapshot.updatedAt).toBe(updatedAt)
        expect(quotaCalls).toBe(0)
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("Google Antigravity marks old, missing, and future-dated cached quota as stale", async () => {
    const now = Date.now()
    const cases = [
      { name: "old", updatedAt: now - 31 * 60 * 1000 },
      { name: "missing", updatedAt: null },
      { name: "future", updatedAt: now + 60 * 1000 },
    ] as const

    await writeAuthJson({
      google: {
        type: "oauth",
        access: "",
        refresh: "antigravity-refresh|project-123",
        expires: 0,
      },
    })

    await withInstance(async () => {
      for (const input of cases) {
        await writeAntigravityAccountsJson({
          version: 4,
          accounts: [
            {
              refreshToken: "antigravity-refresh",
              projectId: "project-123",
              ...(input.updatedAt === null ? {} : { cachedQuotaUpdatedAt: input.updatedAt }),
              cachedQuota: {
                claude: { remainingFraction: 0.25, modelCount: 1 },
              },
            },
          ],
        })
        await clearUsage("google")

        const result = firstResult(await usageBody(await request("/usage?provider=google&refresh=true")))
        expect(result.status, input.name).toBe("stale")
        expect(result.error?.code, input.name).toBe("fetch_failed")
        expect(result.error?.message, input.name).toContain("cached quota is stale")
        expect(windowByLabel(requireSnapshot(result), "Claude Opus")?.usedPercent, input.name).toBe(75)
      }
    })
  })

  test("Google Antigravity skips cached quota without a remaining fraction", async () => {
    await writeAuthJson({
      google: {
        type: "oauth",
        access: "",
        refresh: "antigravity-refresh|project-123",
        expires: 0,
      },
    })
    await writeAntigravityAccountsJson({
      version: 4,
      activeIndex: 0,
      accounts: [
        {
          refreshToken: "antigravity-refresh",
          projectId: "project-123",
          cachedQuotaUpdatedAt: Date.now(),
          cachedQuota: {
            claude: { resetTime: "2026-08-01T00:00:00.000Z", modelCount: 1 },
            "gemini-pro": { remainingFraction: 0.5, modelCount: 1 },
          },
        },
      ],
    })

    await withInstance(async () => {
      await clearUsage("google")
      const response = await request("/usage?provider=google&refresh=true")
      expect(response.status).toBe(200)
      const result = firstResult(await usageBody(response))
      const snapshot = requireSnapshot(result)
      expect(result.status).toBe("ok")
      expect(result.error).toBeUndefined()
      expect(windowByLabel(snapshot, "Claude Opus")).toBeUndefined()
      expect(windowByLabel(snapshot, "Gemini Pro")?.usedPercent).toBe(50)
    })
  })

  test("Google Antigravity ignores unsupported account storage versions", async () => {
    await writeAuthJson({
      google: {
        type: "oauth",
        access: "",
        refresh: "antigravity-refresh|project-123",
        expires: 0,
      },
    })
    await writeAntigravityAccountsJson({
      version: 5,
      activeIndex: 0,
      accounts: [
        {
          refreshToken: "antigravity-refresh",
          projectId: "project-123",
          cachedQuota: { claude: { remainingFraction: 0.25, modelCount: 1 } },
        },
      ],
    })

    await withInstance(async () => {
      await clearUsage("google")
      const response = await request("/usage?provider=google&refresh=true")
      expect(response.status).toBe(200)
      const result = firstResult(await usageBody(response))
      expect(result.status).toBe("unavailable")
      expect(result.snapshot).toBeNull()
      expect(result.error?.message).toContain("missing access token and cached quota")
    })
  })

  test("Google Antigravity rereads cached quota after the active account changes", async () => {
    await writeAuthJson({
      google: {
        type: "oauth",
        access: "",
        refresh: "antigravity-refresh|project-123",
        expires: 0,
      },
    })
    const accounts = [
      {
        refreshToken: "antigravity-refresh",
        projectId: "project-123",
        cachedQuotaUpdatedAt: Date.now(),
        cachedQuota: { claude: { remainingFraction: 0.8, modelCount: 1 } },
      },
      {
        refreshToken: "other-refresh",
        projectId: "other-project",
        cachedQuotaUpdatedAt: Date.now(),
        cachedQuota: { claude: { remainingFraction: 0.2, modelCount: 1 } },
      },
    ]
    await writeAntigravityAccountsJson({ version: 4, activeIndexByFamily: { claude: 0 }, accounts })

    await withInstance(async () => {
      await clearUsage("google")
      const first = await request("/usage?provider=google")
      expect(windowByLabel(requireSnapshot(firstResult(await usageBody(first))), "Claude Opus")?.usedPercent).toBe(20)

      await writeAntigravityAccountsJson({ version: 4, activeIndexByFamily: { claude: 1 }, accounts })
      const second = await request("/usage?provider=google")
      const result = firstResult(await usageBody(second))
      expect(result.status).toBe("ok")
      expect(result.error).toBeUndefined()
      expect(windowByLabel(requireSnapshot(result), "Claude Opus")?.usedPercent).toBe(80)
    })
  })

  test("usage route treats Google Antigravity rate-limit reset as exhausted quota", async () => {
    const originalFetch = globalThis.fetch
    const staleReset = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const resetMs = Date.now() + 6 * 24 * 60 * 60 * 1000
    let quotaCalls = 0

    await writeAuthJson({
      google: {
        type: "oauth",
        access: "",
        refresh: "antigravity-refresh|project-123|managed-456",
        expires: 0,
      },
    })
    await writeAntigravityAccountsJson({
      version: 4,
      activeIndex: 0,
      activeIndexByFamily: { claude: 0, gemini: 0 },
      accounts: [
        {
          email: "test@example.com",
          refreshToken: "antigravity-refresh",
          projectId: "project-123",
          managedProjectId: "managed-456",
          addedAt: 1,
          lastUsed: 1,
          cachedQuotaUpdatedAt: 1,
          rateLimitResetTimes: {
            claude: resetMs,
            "gemini-antigravity": resetMs + 10_000,
            "gemini-antigravity:gemini-3-pro-preview": resetMs + 1000,
            "gemini-cli:gemini-3-pro-preview": resetMs + 20_000,
          },
          cachedQuota: {
            claude: { remainingFraction: 1, resetTime: staleReset, modelCount: 1 },
            "gemini-pro": { remainingFraction: 0, resetTime: staleReset, modelCount: 1 },
            "gemini-flash": { remainingFraction: 0.8, resetTime: staleReset, modelCount: 1 },
          },
        },
      ],
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels") {
        quotaCalls += 1
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("google")
        const response = await request("/usage?provider=google&refresh=true")
        expect(response.status).toBe(200)
        const body = await usageBody(response)
        const result = firstResult(body)
        const snapshot = requireSnapshot(result)
        expect(result.provider).toBe("google")
        expect(result.status).toBe("stale")
        expect(result.error?.message).toContain("cached quota is stale")
        expect(windowByLabel(snapshot, "Claude Opus")?.usedPercent).toBe(100)
        expect(windowByLabel(snapshot, "Claude Opus")?.resetsAt).toBe(Math.floor(resetMs / 1000))
        expect(windowByLabel(snapshot, "Gemini Pro")?.usedPercent).toBe(100)
        expect(windowByLabel(snapshot, "Gemini Pro")?.resetsAt).toBe(Math.floor((resetMs + 10_000) / 1000))
        expect(windowByLabel(snapshot, "Gemini Flash")).toBeUndefined()
        expect(quotaCalls).toBe(0)
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("Google Antigravity ignores expired cached quota without an active rate limit", async () => {
    const staleReset = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    await writeAuthJson({
      google: {
        type: "oauth",
        access: "",
        refresh: "antigravity-refresh|project-123",
        expires: 0,
      },
    })
    await writeAntigravityAccountsJson({
      version: 4,
      accounts: [
        {
          refreshToken: "antigravity-refresh",
          projectId: "project-123",
          cachedQuotaUpdatedAt: 1,
          cachedQuota: {
            claude: { remainingFraction: 0.5, modelCount: 1 },
            "gemini-pro": { remainingFraction: 0.5, resetTime: staleReset, modelCount: 1 },
          },
        },
      ],
    })

    await withInstance(async () => {
      await clearUsage("google")
      const response = await request("/usage?provider=google")
      const result = firstResult(await usageBody(response))
      const snapshot = requireSnapshot(result)
      expect(result.status).toBe("stale")
      expect(result.error?.message).toContain("cached quota is stale")
      expect(windowByLabel(snapshot, "Claude Opus")?.usedPercent).toBe(50)
      expect(windowByLabel(snapshot, "Gemini Pro")).toBeUndefined()
    })
  })

  test("Google Antigravity does not combine limits for different Gemini models", async () => {
    const resetMs = Date.now() + 6 * 24 * 60 * 60 * 1000

    await writeAuthJson({
      google: {
        type: "oauth",
        access: "",
        refresh: "antigravity-refresh|project-123",
        expires: 0,
      },
    })
    await writeAntigravityAccountsJson({
      version: 4,
      accounts: [
        {
          refreshToken: "antigravity-refresh",
          projectId: "project-123",
          cachedQuotaUpdatedAt: Date.now(),
          rateLimitResetTimes: {
            "gemini-antigravity:gemini-3-pro": resetMs,
            "gemini-cli:gemini-3-pro-preview": resetMs,
          },
          cachedQuota: {
            "gemini-pro": { remainingFraction: 0.5, modelCount: 1 },
          },
        },
      ],
    })

    await withInstance(async () => {
      await clearUsage("google")
      const response = await request("/usage?provider=google")
      const snapshot = requireSnapshot(firstResult(await usageBody(response)))
      expect(windowByLabel(snapshot, "Gemini Pro")?.usedPercent).toBe(50)
    })
  })

  test("Google Antigravity keeps quota sampled after its reported reset", async () => {
    const staleReset = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    await writeAuthJson({
      google: {
        type: "oauth",
        access: "",
        refresh: "antigravity-refresh|project-123",
        expires: 0,
      },
    })
    await writeAntigravityAccountsJson({
      version: 4,
      accounts: [
        {
          refreshToken: "antigravity-refresh",
          projectId: "project-123",
          cachedQuotaUpdatedAt: Date.now(),
          cachedQuota: {
            "gemini-flash": { remainingFraction: 0.4, resetTime: staleReset, modelCount: 1 },
          },
        },
      ],
    })

    await withInstance(async () => {
      await clearUsage("google")
      const response = await request("/usage?provider=google")
      const snapshot = requireSnapshot(firstResult(await usageBody(response)))
      expect(windowByLabel(snapshot, "Gemini Flash")?.usedPercent).toBe(60)
      expect(windowByLabel(snapshot, "Gemini Flash")?.resetsAt).toBe(null)
    })
  })

  test("expired Google Antigravity auth asks the plugin to refresh credentials", async () => {
    const originalFetch = globalThis.fetch
    let calls = 0

    await writeAuthJson({
      google: {
        type: "oauth",
        access: "expired-antigravity-token",
        refresh: "antigravity-refresh|project-123|managed-456",
        expires: 1,
      },
    })

    globalThis.fetch = ((_input: RequestInfo | URL) => {
      calls += 1
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("google")
        const response = await request("/usage?provider=google&refresh=true")
        expect(response.status).toBe(200)
        const body = await usageBody(response)
        const result = firstResult(body)
        expect(result.status).toBe("unauthenticated")
        expect(result.error?.code).toBe("reauth_required")
        expect(result.error?.retryable).toBe(false)
        expect(result.error?.message).toContain("Google Antigravity credentials expired")
        expect(calls).toBe(0)
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("rejects inherited provider names", async () => {
    await withInstance(async () => {
      const response = await request("/usage?provider=toString")
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        results: [
          {
            provider: "tostring",
            status: "unsupported",
            snapshot: null,
            error: { code: "unsupported_provider" },
          },
        ],
      })
    })
  })

  test("server refreshes all authenticated providers", async () => {
    const originalFetch = globalThis.fetch

    await writeAuthJson({
      openai: {
        type: "oauth",
        access: "codex-token",
        refresh: "codex-refresh",
        expires: 0,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input.toString()
      if (url === "https://chatgpt.com/backend-api/wham/usage") {
        return Promise.resolve(new Response(JSON.stringify(openaiUsageResponse), { status: 200 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("openai")
        const response = await request("/usage?refresh=true")
        expect(response.status).toBe(200)
        const body = await usageBody(response)
        expect(body.results.length).toBe(1)
        expect(firstResult(body).provider).toBe("openai")
        expect(firstResult(body).status).toBe("ok")
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("explicit refresh refreshes all authenticated providers", async () => {
    const originalFetch = globalThis.fetch
    const calls = {
      openai: 0,
      anthropic: 0,
    }

    await writeAuthJson({
      openai: {
        type: "oauth",
        access: "codex-token",
        refresh: "codex-refresh",
        expires: 0,
      },
      anthropic: {
        type: "oauth",
        access: "claude-token",
        refresh: "claude-refresh",
        expires: 0,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input.toString()
      if (url === "https://chatgpt.com/backend-api/wham/usage") {
        calls.openai += 1
        return Promise.resolve(new Response(JSON.stringify(openaiUsageResponse), { status: 200 }))
      }
      if (url === "https://api.anthropic.com/api/oauth/usage") {
        calls.anthropic += 1
        return Promise.resolve(
          new Response(
            JSON.stringify({
              five_hour: { utilization: 10, resets_at: null },
              seven_day: { utilization: 20, resets_at: null },
              extra_usage: { is_enabled: false },
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("openai")
        await clearUsage("anthropic")

        const response = await request("/usage?refresh=true")
        expect(response.status).toBe(200)
        const body = await usageBody(response)
        expect(body.results.map((result) => result.provider)).toEqual(["anthropic", "openai"])
        expect(body.results.map((result) => result.status)).toEqual(["ok", "ok"])
        expect(calls).toEqual({ openai: 1, anthropic: 1 })
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("provider rejection does not abort other usage results", async () => {
    const originalFetch = globalThis.fetch
    const rejectionDetail = "sensitive provider rejection"

    await writeAuthJson({
      openai: {
        type: "oauth",
        access: "codex-token",
        refresh: "codex-refresh",
        expires: 0,
      },
      anthropic: {
        type: "oauth",
        access: "claude-token",
        refresh: "claude-refresh",
        expires: 0,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input.toString()
      if (url === "https://chatgpt.com/backend-api/wham/usage") throw new Error(rejectionDetail)
      if (url === "https://api.anthropic.com/api/oauth/usage") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              five_hour: { utilization: 10, resets_at: null },
              seven_day: { utilization: 20, resets_at: null },
              extra_usage: { is_enabled: false },
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("openai")
        await clearUsage("anthropic")

        const response = await request("/usage?refresh=true")
        expect(response.status).toBe(200)
        const body = await usageBody(response)
        expect(body.results.map((result) => [result.provider, result.status])).toEqual([
          ["anthropic", "ok"],
          ["openai", "unavailable"],
        ])
        const openai = body.results.find((result) => result.provider === "openai")
        expect(openai?.error?.code).toBe("fetch_failed")
        expect(openai?.error?.message).not.toContain(rejectionDetail)
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("concurrent refresh requests share one provider fetch", async () => {
    const originalFetch = globalThis.fetch
    const calls = { count: 0 }

    await writeAuthJson({
      openai: {
        type: "oauth",
        access: "codex-token",
        refresh: "codex-refresh",
        expires: 0,
      },
    })

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString()
      if (url === "https://chatgpt.com/backend-api/wham/usage") {
        calls.count += 1
        await Bun.sleep(25)
        return new Response(JSON.stringify(openaiUsageResponse), { status: 200 })
      }
      return new Response("", { status: 404 })
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("openai")

        const [first, second] = await Promise.all([
          request("/usage?provider=openai&refresh=true"),
          request("/usage?provider=openai&refresh=true"),
        ])

        expect(first.status).toBe(200)
        expect(second.status).toBe(200)
        expect(calls.count).toBe(1)
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("concurrent refresh requests with rotated auth do not dedupe", async () => {
    const originalFetch = globalThis.fetch
    const calls = { count: 0 }
    const firstFetchStarted = Promise.withResolvers<void>()

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString()
      if (url === "https://chatgpt.com/backend-api/wham/usage") {
        calls.count += 1
        if (calls.count === 1) firstFetchStarted.resolve()
        await Bun.sleep(25)
        return new Response(JSON.stringify(openaiUsageResponse), { status: 200 })
      }
      return new Response("", { status: 404 })
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("openai")

        await writeAuthJson({
          openai: {
            type: "oauth",
            access: "codex-token",
            refresh: "refresh-a",
            expires: 0,
          },
        })
        const firstPromise = request("/usage?provider=openai&refresh=true")

        await firstFetchStarted.promise
        await writeAuthJson({
          openai: {
            type: "oauth",
            access: "codex-token",
            refresh: "refresh-b",
            expires: 0,
          },
        })
        const secondPromise = request("/usage?provider=openai&refresh=true")

        const [first, second] = await Promise.all([firstPromise, secondPromise])
        expect(first.status).toBe(200)
        expect(second.status).toBe(200)
        expect(calls.count).toBe(2)
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("concurrent Copilot requests with rotated access metadata do not dedupe", async () => {
    const originalFetch = globalThis.fetch
    const firstFetchStarted = Promise.withResolvers<void>()
    const releaseFirstFetch = Promise.withResolvers<void>()
    let calls = 0

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (input.toString() !== "https://api.github.com/copilot_internal/user") return new Response("", { status: 404 })
      calls += 1
      if (calls === 1) {
        firstFetchStarted.resolve()
        await releaseFirstFetch.promise
      }
      return new Response("", { status: 500 })
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("github-copilot")
        await writeAuthJson({
          "github-copilot": {
            type: "oauth",
            access: "sku=copilot_for_individual;cq=80",
            refresh: "copilot-device-token",
            expires: 0,
          },
        })
        const first = request("/usage?provider=github-copilot&refresh=true")

        await firstFetchStarted.promise
        await writeAuthJson({
          "github-copilot": {
            type: "oauth",
            access: "sku=copilot_for_individual;cq=40",
            refresh: "copilot-device-token",
            expires: 0,
          },
        })
        const second = request("/usage?provider=github-copilot&refresh=true")
        await Bun.sleep(25)
        releaseFirstFetch.resolve()

        const [firstResult1, secondResult] = await Promise.all([
          Promise.resolve(first).then(usageBody).then(firstResult),
          Promise.resolve(second).then(usageBody).then(firstResult),
        ])
        expect(calls).toBe(2)
        expect(requireSnapshot(firstResult1).credits?.balance).toBe("80")
        expect(requireSnapshot(secondResult).credits?.balance).toBe("40")
      })
    } finally {
      releaseFirstFetch.resolve()
      globalThis.fetch = originalFetch
    }
  })

  test("older credential fetch cannot delete the current credential cache", async () => {
    const originalFetch = globalThis.fetch
    const firstFetchStarted = Promise.withResolvers<void>()
    const releaseFirstFetch = Promise.withResolvers<void>()
    let failUsage = false
    let calls = 0

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString() !== "https://chatgpt.com/backend-api/wham/usage") return new Response("", { status: 404 })
      calls += 1
      if (failUsage) return new Response("", { status: 500 })

      const token = new Headers(init?.headers).get("Authorization")
      if (token === "Bearer token-a") {
        firstFetchStarted.resolve()
        await releaseFirstFetch.promise
      }
      return new Response(
        JSON.stringify({
          ...openaiUsageResponse,
          plan_type: token === "Bearer token-b" ? "pro" : "plus",
        }),
        { status: 200 },
      )
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("openai")
        await writeAuthJson({
          openai: {
            type: "oauth",
            access: "token-a",
            refresh: "refresh-a",
            expires: 0,
          },
        })
        const first = request("/usage?provider=openai&refresh=true")

        await firstFetchStarted.promise
        await writeAuthJson({
          openai: {
            type: "oauth",
            access: "token-b",
            refresh: "refresh-b",
            expires: 0,
          },
        })
        const second = await request("/usage?provider=openai&refresh=true")
        expect(requireSnapshot(firstResult(await usageBody(second))).planType).toBe("pro")

        releaseFirstFetch.resolve()
        expect((await first).status).toBe(200)

        failUsage = true
        const failedRefresh = await request("/usage?provider=openai&refresh=true")
        const result = firstResult(await usageBody(failedRefresh))
        expect(result.status).toBe("stale")
        expect(requireSnapshot(result).planType).toBe("pro")
        expect(result.error?.message).toContain("Showing cached results")
        expect(calls).toBe(3)
      })
    } finally {
      releaseFirstFetch.resolve()
      globalThis.fetch = originalFetch
    }
  })

  test("copilot uses token-based copilot_internal usage with reset date", async () => {
    const originalFetch = globalThis.fetch
    const resetDate = "2026-02-01T00:00:00Z"
    const resetAt = Math.floor(new Date(resetDate).getTime() / 1000)
    const seen = { auth: "", version: "" }

    await writeAuthJson({
      "github-copilot": {
        type: "oauth",
        access: "copilot-access-token",
        refresh: "copilot-device-token",
        expires: 0,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString()
      if (url === "https://api.github.com/copilot_internal/user") {
        const headers = new Headers(init?.headers ?? {})
        seen.auth = headers.get("Authorization") ?? ""
        seen.version = headers.get("X-GitHub-Api-Version") ?? ""
        return Promise.resolve(
          new Response(
            JSON.stringify({
              token_based_billing: true,
              quota_snapshots: {
                premium_interactions: {
                  entitlement: 100,
                  remaining: 41,
                  quota_remaining: 40,
                  percent_remaining: 40,
                  credits_used: 12.5,
                  quota_id: "premium",
                  overage_permitted: true,
                  token_based_billing: true,
                },
                chat: {
                  entitlement: 200,
                  remaining: 50,
                  percent_remaining: 25,
                  quota_id: "chat",
                },
              },
              copilot_plan: "copilot_for_individual",
              quota_reset_date: resetDate,
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("github-copilot")
        const response = await request("/usage?provider=github-copilot")
        expect(response.status).toBe(200)
        const body = await usageBody(response)
        expect(body.results.length).toBe(1)
        const result = firstResult(body)
        expect(result.status).toBe("ok")
        const snapshot = requireSnapshot(result)
        expect(windowByLabel(snapshot, "Monthly")?.usedPercent).toBe(60)
        expect(windowByLabel(snapshot, "Monthly")?.resetsAt).toBe(resetAt)
        expect(snapshot.credits?.balance).toBeNull()
        expect(snapshot.credits?.label).toBe("GitHub AI Credits")
        expect(snapshot.credits?.overagePermitted).toBe(true)
        expect(snapshot.credits?.total).toBeNull()
        expect(snapshot.credits?.used).toBe(12.5)
        expect(snapshot.credits?.remaining).toBeNull()
        expect(seen.auth).toBe("token copilot-device-token")
        expect(seen.version).toBe("2026-03-10")
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("copilot ignores malformed numeric token metadata", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            quota_snapshots: {
              premium_interactions: {
                percent_remaining: 50,
              },
            },
            copilot_plan: "copilot_for_individual",
          }),
          { status: 200 },
        ),
      )) as unknown as typeof fetch

    try {
      const result = await fetchCopilotUsage({
        access: "sku=copilot_for_individual;cq=invalid;rd=invalid:0",
        refresh: "copilot-device-token",
      })
      const snapshot = result.snapshot

      expect(snapshot ? windowByLabel(snapshot, "Monthly")?.resetsAt : undefined).toBeNull()
      expect(snapshot?.credits).toBeNull()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("copilot fallback snapshot is served with its error and never cached", async () => {
    const originalFetch = globalThis.fetch
    let upstreamCalls = 0

    await writeAuthJson({
      "github-copilot": {
        type: "oauth",
        access: "sku=copilot_for_individual;cq=80",
        refresh: "copilot-device-token",
        expires: 0,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://api.github.com/copilot_internal/user") {
        upstreamCalls += 1
        return Promise.resolve(new Response("", { status: 500 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("github-copilot")
        const first = await request("/usage?provider=github-copilot")
        expect(first.status).toBe(200)
        const firstResult1 = firstResult(await usageBody(first))
        expect(firstResult1.status).toBe("stale")
        expect(firstResult1.error?.message).toContain("Copilot usage request failed")
        expect(requireSnapshot(firstResult1).credits?.balance).toBe("80")

        // The degraded token-metadata fallback must not be cached: the next
        // request retries upstream instead of serving it as fresh.
        const second = await request("/usage?provider=github-copilot")
        expect(second.status).toBe(200)
        const secondResult = firstResult(await usageBody(second))
        expect(secondResult.error?.message).toContain("Copilot usage request failed")
        expect(upstreamCalls).toBe(2)
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("copilot without a device token reports reauth", async () => {
    await writeAuthJson({
      "github-copilot": {
        type: "oauth",
        access: "copilot-access-token",
        refresh: "",
        expires: 0,
      },
    })

    await withInstance(async () => {
      await clearUsage("github-copilot")
      const response = await request("/usage?provider=github-copilot")
      expect(response.status).toBe(200)
      const body = await usageBody(response)
      const result = firstResult(body)
      expect(result.status).toBe("unauthenticated")
      expect(result.snapshot).toBeNull()
      expect(result.error?.code).toBe("reauth_required")
      expect(result.error?.message).toContain("opencode auth login")
    })
  })

  test("copilot rejects insecure enterprise URLs without sending the device token", async () => {
    const originalFetch = globalThis.fetch
    let calls = 0

    await writeAuthJson({
      "github-copilot": {
        type: "oauth",
        access: "copilot-access-token",
        refresh: "copilot-device-token",
        expires: 0,
        enterpriseUrl: "http://127.0.0.1:8080",
      },
    })
    globalThis.fetch = ((_input: RequestInfo | URL) => {
      calls += 1
      return Promise.resolve(new Response("", { status: 500 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("github-copilot")
        const response = await request("/usage?provider=github-copilot&refresh=true")
        const result = firstResult(await usageBody(response))
        expect(result.status).toBe("unauthenticated")
        expect(result.error?.message).toContain("HTTPS")
        expect(calls).toBe(0)
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("copilot enterprise usage uses the HTTPS API path without following redirects", async () => {
    const originalFetch = globalThis.fetch
    const seen = { url: "", redirect: "", auth: "" }

    await writeAuthJson({
      "github-copilot": {
        type: "oauth",
        access: "copilot-device-token",
        refresh: "copilot-device-token",
        expires: 0,
        enterpriseUrl: "ghe.example/api/v3/",
      },
    })
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      seen.url = input.toString()
      seen.redirect = init?.redirect ?? ""
      seen.auth = new Headers(init?.headers).get("Authorization") ?? ""
      return Promise.resolve(
        new Response(JSON.stringify({ quota_snapshots: {}, copilot_plan: "copilot_for_individual" }), {
          status: 200,
        }),
      )
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("github-copilot")
        const response = await request("/usage?provider=github-copilot&refresh=true")
        expect(firstResult(await usageBody(response)).status).toBe("ok")
        expect(seen).toEqual({
          url: "https://ghe.example/api/v3/copilot_internal/user",
          redirect: "error",
          auth: "token copilot-device-token",
        })
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  // Zeroed quota counters with has_quota:false represent real exhaustion when
  // credits_used is absent, not an unlimited-plan placeholder.
  test("copilot reports an exhausted token-billing seat as fully used", async () => {
    const originalFetch = globalThis.fetch

    await writeAuthJson({
      "github-copilot": {
        type: "oauth",
        access: "copilot-access-token",
        refresh: "copilot-device-token",
        expires: 0,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://api.github.com/copilot_internal/user") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              token_based_billing: true,
              quota_snapshots: {
                chat: { unlimited: true, has_quota: true, percent_remaining: 100 },
                premium_interactions: {
                  entitlement: 5000,
                  remaining: 0,
                  quota_remaining: 0,
                  percent_remaining: 0,
                  has_quota: false,
                  unlimited: false,
                  overage_permitted: false,
                  token_based_billing: true,
                },
              },
              copilot_plan: "business",
              quota_reset_date: "2026-08-01",
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("github-copilot")
        const response = await request("/usage?provider=github-copilot&refresh=true")
        expect(response.status).toBe(200)
        const result = firstResult(await usageBody(response))
        expect(result.status).toBe("ok")
        const snapshot = requireSnapshot(result)
        expect(windowByLabel(snapshot, "Monthly")?.usedPercent).toBe(100)
        expect(windowByLabel(snapshot, "Monthly")?.resetsAt).toBe(Math.floor(new Date("2026-08-01").getTime() / 1000))
        expect(snapshot.credits?.balance).toBe("0")
        expect(snapshot.credits?.hasCredits).toBe(false)
        expect(snapshot.credits?.label).toBe("GitHub AI Credits")
        expect(snapshot.credits?.total).toBe(5000)
        expect(snapshot.credits?.used).toBe(5000)
        expect(snapshot.credits?.remaining).toBe(0)
        expect(snapshot.planType).toBe("business")
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("copilot prefers premium_models snapshot over the legacy shell", async () => {
    const originalFetch = globalThis.fetch

    await writeAuthJson({
      "github-copilot": {
        type: "oauth",
        access: "copilot-access-token",
        refresh: "copilot-device-token",
        expires: 0,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://api.github.com/copilot_internal/user") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              quota_snapshots: {
                premium_models: {
                  entitlement: 300,
                  quota_remaining: 120,
                  percent_remaining: 40,
                  has_quota: true,
                },
                premium_interactions: {
                  entitlement: 5000,
                  quota_remaining: 0,
                  percent_remaining: 0,
                  credits_used: 12.5,
                  has_quota: false,
                },
              },
              copilot_plan: "copilot_for_individual",
              quota_reset_date: "2026-08-01",
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("github-copilot")
        const response = await request("/usage?provider=github-copilot&refresh=true")
        expect(response.status).toBe(200)
        const result = firstResult(await usageBody(response))
        expect(result.status).toBe("ok")
        const snapshot = requireSnapshot(result)
        expect(windowByLabel(snapshot, "Monthly")?.usedPercent).toBe(60)
        expect(snapshot.credits?.balance).toBeNull()
        expect(snapshot.credits?.label).toBe("GitHub AI Credits")
        expect(snapshot.credits?.total).toBeNull()
        expect(snapshot.credits?.used).toBe(12.5)
        expect(snapshot.credits?.remaining).toBeNull()
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("copilot reports pooled AI credits without inventing a denominator", async () => {
    const originalFetch = globalThis.fetch

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://api.github.com/copilot_internal/user") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              token_based_billing: true,
              quota_snapshots: {
                premium_interactions: {
                  entitlement: 0,
                  remaining: 0,
                  percent_remaining: 100,
                  credits_used: 12.5,
                  unlimited: true,
                  has_quota: true,
                },
              },
              copilot_plan: "business",
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      const result = await fetchCopilotUsage({
        access: "copilot-access-token",
        refresh: "copilot-device-token",
      })
      const snapshot = result.snapshot

      expect(snapshot ? windowByLabel(snapshot, "Monthly")?.usedPercent : undefined).toBe(0)
      expect(snapshot?.credits).toMatchObject({
        hasCredits: true,
        unlimited: true,
        balance: null,
        label: "GitHub AI Credits",
        total: null,
        used: 12.5,
        remaining: null,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("fetch failure returns cached snapshot with error line", async () => {
    const originalFetch = globalThis.fetch
    let failUsage = false

    await writeAuthJson({
      openai: {
        type: "oauth",
        access: "codex-token",
        refresh: "codex-refresh",
        expires: 0,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input.toString()
      if (url === "https://chatgpt.com/backend-api/wham/usage") {
        if (!failUsage) return Promise.resolve(new Response(JSON.stringify(openaiUsageResponse), { status: 200 }))
        return Promise.resolve(new Response("", { status: 500 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("openai")
        const primed = await request("/usage?provider=openai&refresh=true")
        expect(primed.status).toBe(200)
        failUsage = true

        const response = await request("/usage?provider=openai&refresh=true")
        expect(response.status).toBe(200)
        const body = await usageBody(response)
        const result = firstResult(body)
        expect(result.status).toBe("stale")
        expect(result.snapshot).not.toBeNull()
        expect(result.error?.code).toBe("fetch_failed")
        expect(result.error?.message).toContain("Showing cached results")
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("expired oauth with cached snapshot returns stale reauth result", async () => {
    const originalFetch = globalThis.fetch
    const calls = {
      token: 0,
      usage: 0,
    }

    await writeAuthJson({
      openai: {
        type: "oauth",
        access: "codex-token",
        refresh: "openai-refresh",
        expires: 0,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input.toString()
      if (url === "https://auth.openai.com/oauth/token") {
        calls.token += 1
        return Promise.resolve(new Response("", { status: 500 }))
      }
      if (url === "https://chatgpt.com/backend-api/wham/usage") {
        calls.usage += 1
        return Promise.resolve(new Response(JSON.stringify(openaiUsageResponse), { status: 200 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("openai")
        const primed = await request("/usage?provider=openai&refresh=true")
        expect(primed.status).toBe(200)

        // Same identity (access/refresh unchanged), now expired: usage must not
        // refresh, and the cached snapshot is served as stale with a reauth hint.
        await writeAuthJson({
          openai: {
            type: "oauth",
            access: "codex-token",
            refresh: "openai-refresh",
            expires: 1,
          },
        })

        const refreshed = await request("/usage?provider=openai&refresh=true")
        expect(refreshed.status).toBe(200)
        const refreshedBody = await usageBody(refreshed)
        const refreshedResult = firstResult(refreshedBody)
        expect(refreshedResult.status).toBe("stale")
        expect(windowByLabel(requireSnapshot(refreshedResult), "5h")?.usedPercent).toBe(10)
        expect(refreshedResult.error?.code).toBe("reauth_required")
        expect(refreshedResult.error?.retryable).toBe(false)
        expect(refreshedResult.error?.message).toContain("Showing cached results")
        expect(calls).toEqual({ token: 0, usage: 1 })
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("token rotation does not persist usage cache records", async () => {
    const originalFetch = globalThis.fetch
    let failUsage = false

    await writeAuthJson({
      openai: {
        type: "oauth",
        access: "codex-token",
        refresh: "openai-refresh",
        expires: 0,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://chatgpt.com/backend-api/wham/usage") {
        if (failUsage) return Promise.resolve(new Response("", { status: 500 }))
        return Promise.resolve(new Response(JSON.stringify(openaiUsageResponse), { status: 200 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("openai")
        const first = await request("/usage?provider=openai&refresh=true")
        expect(first.status).toBe(200)

        await writeAuthJson({
          openai: {
            type: "oauth",
            access: "rotated-token",
            refresh: "openai-refresh",
            expires: 0,
          },
        })

        const second = await request("/usage?provider=openai&refresh=true")
        expect(second.status).toBe(200)

        const records = await fs.readdir(path.join(Global.Path.data, "storage", "usage", "openai")).catch(() => [])
        expect(records).toEqual([])

        await writeAuthJson({
          openai: {
            type: "oauth",
            access: "codex-token",
            refresh: "openai-refresh",
            expires: 0,
          },
        })
        failUsage = true

        const retired = firstResult(await usageBody(await request("/usage?provider=openai&refresh=true")))
        expect(retired.status).toBe("unavailable")
        expect(retired.snapshot).toBeNull()
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("copilot fallback does not overwrite cache", async () => {
    const originalFetch = globalThis.fetch
    let failUsage = false

    await writeAuthJson({
      "github-copilot": {
        type: "oauth",
        access: "sku=copilot_for_individual;cq=80",
        refresh: "copilot-device-token",
        expires: 0,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input.toString()
      if (url === "https://api.github.com/copilot_internal/user") {
        if (!failUsage) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                quota_snapshots: {
                  premium_interactions: {
                    entitlement: 100,
                    quota_remaining: 90,
                    percent_remaining: 90,
                    quota_id: "premium",
                  },
                },
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(new Response("", { status: 500 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("github-copilot")
        const primed = await request("/usage?provider=github-copilot&refresh=true")
        expect(primed.status).toBe(200)
        failUsage = true

        const response = await request("/usage?provider=github-copilot&refresh=true")
        expect(response.status).toBe(200)
        const body = await usageBody(response)
        const result = firstResult(body)
        expect(result.status).toBe("stale")
        expect(windowByLabel(requireSnapshot(result), "Monthly")?.usedPercent).toBe(10)
        expect(result.error?.message).toContain("Copilot usage request failed")

        const cached = await request("/usage?provider=github-copilot&refresh=false")
        const cachedBody = await usageBody(cached)
        expect(windowByLabel(requireSnapshot(firstResult(cachedBody)), "Monthly")?.usedPercent).toBe(10)
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  // Live-observed shape: legacy five_hour/seven_day coexist with the new
  // limits[] array; model-scoped buckets (Fable) only exist in limits[].
  // is_active marks the binding limit, not availability — the enforced
  // session window reports is_active:false and must still render.
  test("claude renders model-scoped weekly limits from limits[]", async () => {
    const originalFetch = globalThis.fetch
    const auth = {
      type: "oauth" as const,
      access: "claude-token",
      refresh: "claude-refresh",
      expires: 0,
    }
    const weeklyReset = "2026-07-18T06:59:59.781169+00:00"

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://api.anthropic.com/api/oauth/usage") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              five_hour: { utilization: 7.0, resets_at: "2026-07-13T14:09:59.780897+00:00" },
              seven_day: { utilization: 11.0, resets_at: "2026-07-18T06:59:59.780918+00:00" },
              seven_day_opus: null,
              seven_day_sonnet: null,
              extra_usage: { is_enabled: false },
              limits: [
                {
                  kind: "session",
                  group: "session",
                  percent: 7,
                  resets_at: weeklyReset,
                  scope: null,
                  is_active: false,
                },
                {
                  kind: "weekly_all",
                  group: "weekly",
                  percent: 11,
                  resets_at: weeklyReset,
                  scope: null,
                  is_active: true,
                },
                {
                  kind: "weekly_scoped",
                  group: "weekly",
                  percent: 42,
                  resets_at: weeklyReset,
                  scope: { model: { id: null, display_name: "Fable" }, surface: null },
                  is_active: false,
                },
              ],
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      const result = await fetchClaudeUsage(auth)
      const snapshot = result.snapshot
      expect(snapshot?.windows.map((window) => window.label)).toEqual(["5h", "Weekly", "Fable Weekly"])
      expect(snapshot ? windowByLabel(snapshot, "5h")?.usedPercent : undefined).toBe(7)
      expect(snapshot ? windowByLabel(snapshot, "Weekly")?.usedPercent : undefined).toBe(11)
      expect(snapshot ? windowByLabel(snapshot, "Fable Weekly")?.usedPercent : undefined).toBe(42)
      expect(snapshot ? windowByLabel(snapshot, "Fable Weekly")?.windowMinutes : undefined).toBe(7 * 24 * 60)
      expect(snapshot ? windowByLabel(snapshot, "Fable Weekly")?.resetsAt : undefined).toBe(
        Math.floor(Date.parse(weeklyReset) / 1000),
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("claude falls back to limits[] when legacy windows are absent", async () => {
    const originalFetch = globalThis.fetch
    const auth = {
      type: "oauth" as const,
      access: "claude-token",
      refresh: "claude-refresh",
      expires: 0,
    }

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://api.anthropic.com/api/oauth/usage") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              limits: [
                { kind: "session", group: "session", percent: 12, resets_at: null, scope: null },
                { kind: "weekly_all", group: "weekly", percent: 34, resets_at: null, scope: null },
              ],
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      const result = await fetchClaudeUsage(auth)
      const snapshot = result.snapshot
      expect(snapshot?.windows.map((window) => window.label)).toEqual(["Session", "Weekly"])
      expect(snapshot ? windowByLabel(snapshot, "Session")?.usedPercent : undefined).toBe(12)
      expect(snapshot ? windowByLabel(snapshot, "Weekly")?.usedPercent : undefined).toBe(34)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("claude dedupes scoped and legacy model buckets", async () => {
    const originalFetch = globalThis.fetch
    const auth = {
      type: "oauth" as const,
      access: "claude-token",
      refresh: "claude-refresh",
      expires: 0,
    }

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://api.anthropic.com/api/oauth/usage") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              five_hour: { utilization: 5, resets_at: null },
              seven_day: { utilization: 10, resets_at: null },
              seven_day_sonnet: { utilization: 40, resets_at: null },
              limits: [
                {
                  // group omitted: kind weekly_scoped alone must keep the
                  // entry weekly so it still dedupes the legacy sonnet key.
                  kind: "weekly_scoped",
                  percent: 40,
                  resets_at: null,
                  scope: { model: { id: null, display_name: "Sonnet" } },
                },
              ],
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      const result = await fetchClaudeUsage(auth)
      const snapshot = result.snapshot
      const sonnetWindows = snapshot?.windows.filter((window) => window.label === "Sonnet Weekly")
      expect(sonnetWindows).toHaveLength(1)
      expect(sonnetWindows?.[0]?.usedPercent).toBe(40)
      expect(sonnetWindows?.[0]?.id).toBe("weekly-sonnet")
      expect(sonnetWindows?.[0]?.windowMinutes).toBe(7 * 24 * 60)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("claude duplicate scoped buckets keep distinct window ids", async () => {
    const originalFetch = globalThis.fetch
    const auth = {
      type: "oauth" as const,
      access: "claude-token",
      refresh: "claude-refresh",
      expires: 0,
    }

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://api.anthropic.com/api/oauth/usage") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              five_hour: { utilization: 5, resets_at: null },
              seven_day: { utilization: 10, resets_at: null },
              limits: [
                {
                  kind: "weekly_scoped",
                  group: "weekly",
                  percent: 20,
                  resets_at: null,
                  scope: { model: { id: "fable-5", display_name: "Fable" } },
                },
                {
                  kind: "weekly_scoped",
                  group: "weekly",
                  percent: 30,
                  resets_at: null,
                  scope: { model: { id: "fable-5-mini", display_name: "Fable" } },
                },
              ],
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      const result = await fetchClaudeUsage(auth)
      const snapshot = result.snapshot
      const fableWindows = snapshot?.windows.filter((window) => window.label === "Fable Weekly") ?? []
      expect(fableWindows.map((window) => window.id)).toEqual(["weekly-fable", "weekly-fable-2"])
      expect(fableWindows.map((window) => window.usedPercent)).toEqual([20, 30])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("claude renders a legacy sonnet bucket when limits[] is absent", async () => {
    const originalFetch = globalThis.fetch
    const auth = {
      type: "oauth" as const,
      access: "claude-token",
      refresh: "claude-refresh",
      expires: 0,
    }

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://api.anthropic.com/api/oauth/usage") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              five_hour: { utilization: 5, resets_at: null },
              seven_day: { utilization: 10, resets_at: null },
              seven_day_sonnet: { utilization: 60, resets_at: null },
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      const result = await fetchClaudeUsage(auth)
      const snapshot = result.snapshot
      expect(snapshot?.windows.map((window) => window.label)).toEqual(["5h", "Weekly", "Sonnet Weekly"])
      expect(snapshot ? windowByLabel(snapshot, "Sonnet Weekly")?.usedPercent : undefined).toBe(60)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("copilot cache includes access metadata used by sparse responses", async () => {
    const originalFetch = globalThis.fetch
    let upstreamCalls = 0

    await writeAuthJson({
      "github-copilot": {
        type: "oauth",
        access: "sku=copilot_for_individual;cq=80",
        refresh: "copilot-device-token",
        expires: 0,
      },
    })

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://api.github.com/copilot_internal/user") {
        upstreamCalls += 1
        return Promise.resolve(new Response(JSON.stringify({ quota_snapshots: {} }), { status: 200 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("github-copilot")
        const primed = await request("/usage?provider=github-copilot&refresh=true")
        expect(primed.status).toBe(200)
        expect(requireSnapshot(firstResult(await usageBody(primed))).credits?.balance).toBe("80")

        await writeAuthJson({
          "github-copilot": {
            type: "oauth",
            access: "sku=copilot_for_individual;cq=40",
            refresh: "copilot-device-token",
            expires: 0,
          },
        })

        const response = await request("/usage?provider=github-copilot")
        expect(response.status).toBe(200)
        const result = firstResult(await usageBody(response))
        expect(result.status).toBe("ok")
        expect(requireSnapshot(result).credits?.balance).toBe("40")
        expect(upstreamCalls).toBe(2)
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("copilot fallback keeps zero quota from token metadata", async () => {
    const originalFetch = globalThis.fetch

    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://api.github.com/copilot_internal/user") {
        return Promise.resolve(new Response("", { status: 500 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      const result = await fetchCopilotUsage({
        access: "sku=copilot_for_individual;cq=0",
        refresh: "copilot-device-token",
      })

      expect(result.snapshot?.credits?.balance).toBe("0")
      expect(result.snapshot?.credits?.hasCredits).toBe(false)
      expect(result.snapshot?.credits?.remaining).toBe(0)
      expect(result.snapshot?.credits?.used).toBeNull()
      expect(result.snapshot?.credits?.total).toBeNull()
      expect(result.error?.message).toContain("Copilot usage request failed")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("claude usage credits map to credits", async () => {
    const originalFetch = globalThis.fetch
    const auth = {
      type: "oauth" as const,
      access: "claude-token",
      refresh: "claude-refresh",
      expires: 0,
    }

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input.toString()
      if (url === "https://api.anthropic.com/api/oauth/usage") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              five_hour: { utilization: 0, resets_at: null },
              seven_day: { utilization: 50, resets_at: null },
              extra_usage: {
                is_enabled: true,
                monthly_limit: 2000,
                used_credits: 1900,
                utilization: 95,
              },
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      const result = await fetchClaudeUsage(auth)
      const snapshot = result.snapshot
      expect(snapshot ? windowByLabel(snapshot, "5h")?.usedPercent : undefined).toBe(0)
      expect(snapshot ? windowByLabel(snapshot, "Weekly")?.usedPercent : undefined).toBe(50)
      expect(snapshot?.credits?.balance).toBe("100")
      expect(snapshot?.credits?.hasCredits).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("empty provider snapshots are unavailable and never cached", async () => {
    const originalFetch = globalThis.fetch
    let calls = 0

    await writeAuthJson({
      anthropic: {
        type: "oauth",
        access: "claude-token",
        refresh: "claude-refresh",
        expires: 0,
      },
    })
    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (input.toString() === "https://api.anthropic.com/api/oauth/usage") {
        calls += 1
        return Promise.resolve(new Response("{}", { status: 200 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      await withInstance(async () => {
        await clearUsage("anthropic")
        const first = firstResult(await usageBody(await request("/usage?provider=anthropic")))
        const second = firstResult(await usageBody(await request("/usage?provider=anthropic")))
        expect(first.status).toBe("unavailable")
        expect(first.snapshot).toBeNull()
        expect(second.status).toBe("unavailable")
        expect(calls).toBe(2)
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("claude unrecoverable auth failure suggests re-login", async () => {
    const originalFetch = globalThis.fetch
    const auth = {
      type: "oauth" as const,
      access: "claude-token",
      refresh: "claude-refresh",
      expires: 0,
    }

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input.toString()
      if (url === "https://api.anthropic.com/api/oauth/usage") {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: "expired", details: { error_code: "token_expired" } } }), {
            status: 401,
          }),
        )
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }) as typeof fetch

    try {
      const result = await fetchClaudeUsage(auth)
      expect(result.snapshot).toBeNull()
      expect(result.error?.kind).toBe("auth")
      expect(result.error?.message).toContain("opencode auth login")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
