// quota-fetch.test.ts — TUI Quota 自动化测试，覆盖 quota.tsx 抽离的纯逻辑
//   - readQuotaAuth：github-copilot oauth 来源 + 异常分支
//   - parseCopilotQuota：正常解析 + 字段缺失返回 null
//   - fetchQuota：正常 200 + 非 200 + fetch 抛错（含 timeout）
// 不覆盖：Solid 组件渲染、setInterval 调度、opentui Slot 逻辑
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import {
  fetchQuota,
  parseCopilotQuota,
  readQuotaAuth,
  type QuotaAuth,
} from "@/cli/cmd/tui/feature-plugins/session/quota-fetch"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("readQuotaAuth", () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "quota-auth-"))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("github-copilot oauth → quotaUrl 默认 api.github.com", async () => {
    await writeFile(
      path.join(dir, "auth.json"),
      JSON.stringify({
        "github-copilot": { type: "oauth", refresh: "gho_test" },
      }),
    )
    const auth = await readQuotaAuth(dir)
    expect(auth).toEqual({
      quotaUrl: "https://api.github.com/copilot_internal/user",
      token: "gho_test",
    })
  })

  test("github-copilot enterpriseUrl 注入 api. 子域", async () => {
    await writeFile(
      path.join(dir, "auth.json"),
      JSON.stringify({
        "github-copilot": {
          type: "oauth",
          refresh: "gho_ent",
          enterpriseUrl: "https://ghes.corp.io/",
        },
      }),
    )
    const auth = await readQuotaAuth(dir)
    expect(auth?.quotaUrl).toBe("https://api.ghes.corp.io/copilot_internal/user")
  })

  test("auth.json 不存在 → 返回 null", async () => {
    expect(await readQuotaAuth(dir)).toBeNull()
  })

  test("auth.json 非法 JSON → 返回 null", async () => {
    await writeFile(path.join(dir, "auth.json"), "{not json")
    expect(await readQuotaAuth(dir)).toBeNull()
  })

  test("非 oauth 类型 → 返回 null", async () => {
    await writeFile(
      path.join(dir, "auth.json"),
      JSON.stringify({ "github-copilot": { type: "api", key: "sk-test" } }),
    )
    expect(await readQuotaAuth(dir)).toBeNull()
  })

  test("缺 refresh → 返回 null", async () => {
    await writeFile(
      path.join(dir, "auth.json"),
      JSON.stringify({ "github-copilot": { type: "oauth" } }),
    )
    expect(await readQuotaAuth(dir)).toBeNull()
  })
})

describe("parseCopilotQuota", () => {
  test("percentRemaining 翻转为 used 数值，entitlement 固定 100", () => {
    expect(
      parseCopilotQuota({
        quotaSnapshots: { premiumInteractions: { percentRemaining: 75 } },
      }),
    ).toEqual({ remaining: 25, entitlement: 100 })
  })

  test("缺 quotaSnapshots → null", () => {
    expect(parseCopilotQuota({})).toBeNull()
  })

  test("percentRemaining 非 number → null", () => {
    expect(
      parseCopilotQuota({
        quotaSnapshots: { premiumInteractions: { percentRemaining: "75" } },
      }),
    ).toBeNull()
  })
})

describe("fetchQuota", () => {
  const auth: QuotaAuth = {
    quotaUrl: "https://api.github.com/copilot_internal/user",
    token: "gho_test",
  }

  test("200 → parseCopilotQuota，header 注入 token 前缀", async () => {
    let captured: Record<string, string> = {}
    globalThis.fetch = mock(async (_url: string | URL, init?: RequestInit) => {
      captured = (init?.headers ?? {}) as Record<string, string>
      return new Response(
        JSON.stringify({ quotaSnapshots: { premiumInteractions: { percentRemaining: 60 } } }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    const q = await fetchQuota(auth)
    expect(q).toEqual({ remaining: 40, entitlement: 100 })
    expect(captured.Authorization).toBe("token gho_test")
  })

  test("非 200 → 返回 null（不抛）", async () => {
    globalThis.fetch = mock(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch
    expect(await fetchQuota(auth)).toBeNull()
  })

  test("fetch 抛错（如 timeout）→ 返回 null", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("AbortError")
    }) as unknown as typeof fetch
    expect(await fetchQuota(auth)).toBeNull()
  })

  test("响应 JSON 字段不完整 → 返回 null", async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch
    expect(await fetchQuota(auth)).toBeNull()
  })
})
