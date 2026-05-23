// [fork-only] config-schema 单测
// [feat: feishu-bridge] 2026-05-08

import { describe, expect, test } from "bun:test"
import {
  FeishuAdapterConfigSchema,
  FeishuAccountSchema,
  FeishuGroupConfigSchema,
  FeishuHeartbeatSchema,
  emptyConfig,
  safeParseConfig,
  effectiveGroupConfig,
  type FeishuAccount,
} from "../core/config-schema"

// ============================================================
// 顶层 + 默认
// ============================================================

describe("FeishuAdapterConfigSchema", () => {
  test("emptyConfig 返默认值", () => {
    const c = emptyConfig()
    expect(c.version).toBe(1)
    expect(c.accounts).toEqual({})
    expect(c.paused).toBe(false)
    expect(c.logLevel).toBe("info")
  })

  test("解析空对象用默认填充", () => {
    const r = FeishuAdapterConfigSchema.parse({})
    expect(r).toEqual(emptyConfig())
  })

  test("非法 logLevel 拒绝", () => {
    expect(() => FeishuAdapterConfigSchema.parse({ logLevel: "verbose" })).toThrow()
  })
})

// ============================================================
// 单账号 schema
// ============================================================

const validAccount = {
  appId: "cli_xxx",
  appSecret: { type: "plaintext" as const, value: "secret123" },
  openId: "ou_xxx",
  domain: "feishu" as const,
}

describe("FeishuAccountSchema", () => {
  test("最小合法账号", () => {
    const a = FeishuAccountSchema.parse(validAccount)
    expect(a.appId).toBe("cli_xxx")
    expect(a.connectionMode).toBe("websocket")
    expect(a.requireMention).toBe(true)
    expect(a.dmPolicy).toBe("allowlist")
    expect(a.threadSession).toBe(true)
    expect(a.tables).toBe("bullets")
    expect(a.blockStreamingCoalesce).toBe(50)
    // [feat: feishu-bridge-light] 自动建群默认关
    expect(a.enableAutoGroupCreate).toBe(false)
  })

  test("[feat: feishu-bridge-light] enableAutoGroupCreate 显式 true 接受", () => {
    const a = FeishuAccountSchema.parse({ ...validAccount, enableAutoGroupCreate: true })
    expect(a.enableAutoGroupCreate).toBe(true)
  })

  test("appId 不可空", () => {
    expect(() => FeishuAccountSchema.parse({ ...validAccount, appId: "" })).toThrow()
  })

  test("openId 不可空", () => {
    expect(() => FeishuAccountSchema.parse({ ...validAccount, openId: "" })).toThrow()
  })

  test("非法 domain 拒绝", () => {
    expect(() =>
      FeishuAccountSchema.parse({ ...validAccount, domain: "wechat" as never }),
    ).toThrow()
  })

  test("blockStreamingCoalesce 范围 0-1000", () => {
    expect(() =>
      FeishuAccountSchema.parse({ ...validAccount, blockStreamingCoalesce: -1 }),
    ).toThrow()
    expect(() =>
      FeishuAccountSchema.parse({ ...validAccount, blockStreamingCoalesce: 1001 }),
    ).toThrow()
  })

  test("SecretRef 三档全接受", () => {
    const a1 = FeishuAccountSchema.parse({
      ...validAccount,
      appSecret: { type: "plaintext", value: "x" },
    })
    expect(a1.appSecret.type).toBe("plaintext")

    const a2 = FeishuAccountSchema.parse({
      ...validAccount,
      appSecret: { type: "env", name: "MY_SECRET" },
    })
    expect(a2.appSecret.type).toBe("env")

    const a3 = FeishuAccountSchema.parse({
      ...validAccount,
      appSecret: { type: "file", path: "/tmp/x.key" },
    })
    expect(a3.appSecret.type).toBe("file")
  })
})

// ============================================================
// 群级配置
// ============================================================

describe("FeishuGroupConfigSchema", () => {
  test("默认 enabled true", () => {
    const g = FeishuGroupConfigSchema.parse({})
    expect(g.enabled).toBe(true)
  })

  test("可选字段都可省", () => {
    const g = FeishuGroupConfigSchema.parse({})
    expect(g.systemPrompt).toBeUndefined()
    expect(g.tools).toBeUndefined()
    expect(g.skills).toBeUndefined()
  })

  test("非法 replyMode 拒绝", () => {
    expect(() =>
      FeishuGroupConfigSchema.parse({ replyMode: "manual" as never }),
    ).toThrow()
  })
})

// ============================================================
// heartbeat schema
// ============================================================

describe("FeishuHeartbeatSchema", () => {
  test("默认 disabled", () => {
    const h = FeishuHeartbeatSchema.parse({})
    expect(h.enabled).toBe(false)
    expect(h.targets).toEqual([])
  })

  test("activeHours 格式校验:9-18 OK", () => {
    const h = FeishuHeartbeatSchema.parse({ activeHours: "9-18" })
    expect(h.activeHours).toBe("9-18")
  })

  test("activeHours 非法格式拒绝", () => {
    expect(() => FeishuHeartbeatSchema.parse({ activeHours: "morning-evening" })).toThrow()
    expect(() => FeishuHeartbeatSchema.parse({ activeHours: "9:00-18:00" })).toThrow()
  })

  test("schedule 不可空字符串", () => {
    expect(() => FeishuHeartbeatSchema.parse({ schedule: "" })).toThrow()
  })
})

// ============================================================
// safeParseConfig
// ============================================================

describe("safeParseConfig", () => {
  test("合法对象 ok", () => {
    const r = safeParseConfig({})
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.version).toBe(1)
    }
  })

  test("非法对象返 error 信息", () => {
    const r = safeParseConfig({ logLevel: "wrong" })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("logLevel")
    }
  })

  test("error 含 path", () => {
    const r = safeParseConfig({
      accounts: {
        "test": {
          appId: "x",
          appSecret: { type: "plaintext", value: "y" },
          openId: "",
          domain: "feishu",
        },
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("openId")
    }
  })

  test("非对象输入也安全(不抛)", () => {
    const r = safeParseConfig(null)
    expect(r.ok).toBe(false)
    const r2 = safeParseConfig("not-an-object")
    expect(r2.ok).toBe(false)
  })
})

// ============================================================
// effectiveGroupConfig
// ============================================================

describe("effectiveGroupConfig", () => {
  function makeAccount(overrides: Partial<FeishuAccount> = {}): FeishuAccount {
    return FeishuAccountSchema.parse({ ...validAccount, ...overrides })
  }

  test("无群配置 fallback 账号级", () => {
    const a = makeAccount({ systemPrompt: "account-prompt", tools: ["read"], tables: "code" })
    const eff = effectiveGroupConfig(a, "any-chat-id")
    expect(eff.enabled).toBe(true)
    expect(eff.systemPrompt).toBe("account-prompt")
    expect(eff.tools).toEqual(["read"])
    expect(eff.tables).toBe("code")
    expect(eff.skills).toBeUndefined()
  })

  test("有群配置覆盖账号级", () => {
    const a = makeAccount({
      systemPrompt: "account-prompt",
      tools: ["read"],
      tables: "code",
      groups: {
        "chat-123": {
          enabled: true,
          systemPrompt: "group-prompt",
          tools: ["read", "bash"],
          tables: "bullets",
        },
      },
    })
    const eff = effectiveGroupConfig(a, "chat-123")
    expect(eff.systemPrompt).toBe("group-prompt")
    expect(eff.tools).toEqual(["read", "bash"])
    expect(eff.tables).toBe("bullets")
  })

  test("群配置部分覆盖,缺的 fallback 账号级", () => {
    const a = makeAccount({
      systemPrompt: "account-prompt",
      tools: ["read"],
      groups: {
        "chat-456": {
          enabled: true,
          systemPrompt: "only-prompt-overridden",
        },
      },
    })
    const eff = effectiveGroupConfig(a, "chat-456")
    expect(eff.systemPrompt).toBe("only-prompt-overridden")
    expect(eff.tools).toEqual(["read"]) // fallback
  })

  test("群配置 enabled false", () => {
    const a = makeAccount({
      groups: {
        "disabled-chat": { enabled: false },
      },
    })
    const eff = effectiveGroupConfig(a, "disabled-chat")
    expect(eff.enabled).toBe(false)
  })

  test("replyMode 默认 auto", () => {
    const a = makeAccount()
    const eff = effectiveGroupConfig(a, "any")
    expect(eff.replyMode).toBe("auto")
  })

  test("群级 replyMode 覆盖", () => {
    const a = makeAccount({
      groups: { "x": { enabled: true, replyMode: "streaming" } },
    })
    const eff = effectiveGroupConfig(a, "x")
    expect(eff.replyMode).toBe("streaming")
  })
})

// ============================================================
// 综合:多账号 + 群级 + heartbeat 完整配置
// ============================================================

describe("综合配置", () => {
  test("完整 production-like 配置 parse 成功", () => {
    const config = {
      version: 1 as const,
      accounts: {
        "company-a": {
          appId: "cli_a",
          appSecret: { type: "file" as const, path: "/tmp/a.key" },
          openId: "ou_a",
          domain: "feishu" as const,
          allowFrom: ["ou_a", "ou_friend"],
          groupAllowFrom: ["ou_a"],
          groups: {
            "chat-product": {
              enabled: true,
              systemPrompt: "PM-style",
              tools: ["read", "grep"],
              tables: "bullets" as const,
            },
            "chat-engineering": {
              enabled: true,
              systemPrompt: "engineer-style",
              tools: ["read", "grep", "bash"],
            },
          },
          heartbeat: {
            enabled: true,
            schedule: "0 9 * * 1-5",
            activeHours: "9-18",
            message: "早上好",
            targets: ["ou_a"],
          },
          threadSession: true,
        },
        "company-b-lark": {
          appId: "cli_b",
          appSecret: { type: "env" as const, name: "COMPANY_B_SECRET" },
          openId: "ou_b",
          domain: "lark" as const,
        },
      },
      paused: false,
      logLevel: "info" as const,
    }
    const r = FeishuAdapterConfigSchema.parse(config)
    expect(Object.keys(r.accounts)).toHaveLength(2)
    expect(r.accounts["company-a"]!.heartbeat?.enabled).toBe(true)
    expect(r.accounts["company-b-lark"]!.domain).toBe("lark")
  })
})
