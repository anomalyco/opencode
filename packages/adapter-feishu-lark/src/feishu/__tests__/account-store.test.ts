// [fork-only] account-store 单测
// [feat: feishu-bridge] 2026-05-08

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir, platform } from "node:os"
import { join } from "node:path"
import {
  defaultConfigPath,
  deleteAccount,
  listAccounts,
  loadConfig,
  saveAccount,
  saveConfig,
  updateAccountModel,
  updateAccountSettings,
} from "../account-store"
import { readSecret } from "../../core/secret-ref"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "account-store-test-"))
})

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

function configPath(): string {
  return join(tmpDir, "feishu-config.json")
}

// ============================================================
// defaultConfigPath
// ============================================================

describe("defaultConfigPath", () => {
  test("含 ~/.opencode/feishu-config.json", () => {
    const p = defaultConfigPath()
    expect(p).toContain(".opencode")
    expect(p).toEndWith("feishu-config.json")
  })
})

// ============================================================
// loadConfig
// ============================================================

describe("loadConfig", () => {
  test("文件不存在 → 返默认空 config", () => {
    const c = loadConfig(configPath())
    expect(c.version).toBe(1)
    expect(c.accounts).toEqual({})
    expect(c.paused).toBe(false)
    expect(c.logLevel).toBe("info")
  })

  test("文件存在 + 合法 → 解析", () => {
    const validJson = {
      version: 1,
      accounts: {},
      paused: false,
      logLevel: "info",
    }
    saveConfig(validJson as never, configPath())
    const c = loadConfig(configPath())
    expect(c.version).toBe(1)
  })

  test("文件存在 + 非法 JSON → fallback 默认 + warn", () => {
    require("node:fs").writeFileSync(configPath(), "not-json", "utf-8")
    // 不抛错,fallback 默认
    const c = loadConfig(configPath())
    expect(c.accounts).toEqual({})
  })

  test("文件存在 + JSON 但 schema 不对 → fallback", () => {
    require("node:fs").writeFileSync(
      configPath(),
      JSON.stringify({ logLevel: "invalid-level" }),
      "utf-8",
    )
    const c = loadConfig(configPath())
    expect(c.accounts).toEqual({})
  })
})

// ============================================================
// saveAccount(主入口)
// ============================================================

describe("saveAccount", () => {
  test("首次保存账号:配置文件 + secret 文件双写", () => {
    const r = saveAccount({
      domain: "feishu",
      appId: "cli_xxx",
      appSecret: "secret_value_123",
      openId: "ou_xxx",
      configPath: configPath(),
    })
    expect(r.accountId).toBe("cli_xxx") // 默认用 appId
    expect(r.account.appId).toBe("cli_xxx")
    expect(r.account.openId).toBe("ou_xxx")
    expect(r.account.domain).toBe("feishu")
    expect(r.account.appSecret.type).toBe(platform() === "win32" ? "plaintext" : "file")

    // 配置文件存在 + accounts 含 entry
    expect(existsSync(configPath())).toBe(true)
    const config = loadConfig(configPath())
    expect(config.accounts["cli_xxx"]).toBeDefined()

    // appSecret 走 SecretRef,真 secret 不在主 JSON 里
    const json = readFileSync(configPath(), "utf-8")
    if (platform() !== "win32") {
      expect(json).not.toContain("secret_value_123")
    }

    // 通过 readSecret 取回
    const restored = readSecret(r.account.appSecret)
    expect(restored).toBe("secret_value_123")
  })

  test("新绑账号默认 agent = 'imbot'(不是 'build')[feat: feishu-bridge-imbot-agent]", () => {
    const r = saveAccount({
      domain: "feishu",
      appId: "cli_imbot_default",
      appSecret: "s",
      openId: "o",
      configPath: configPath(),
    })
    expect(r.account.agent).toBe("imbot")
  })

  test("已绑账号(老 user agent=build)第二次 save 保留旧 agent 不动", () => {
    // 模拟老 user:第一次 save 后手动改 agent → build(走 v2 老路径)
    saveAccount({
      domain: "feishu",
      appId: "cli_legacy_build",
      appSecret: "s",
      openId: "o",
      configPath: configPath(),
    })
    const cfg = loadConfig(configPath())
    cfg.accounts["cli_legacy_build"].agent = "build"
    saveConfig(cfg, configPath())

    // 第二次 saveAccount(refresh) 应**保留** existing agent=build,不强制升级到 imbot
    const r2 = saveAccount({
      domain: "feishu",
      appId: "cli_legacy_build",
      appSecret: "s2",
      openId: "o",
      configPath: configPath(),
    })
    expect(r2.account.agent).toBe("build")
  })

  test("自定 accountId 覆盖 appId", () => {
    const r = saveAccount({
      accountId: "company-a",
      domain: "feishu",
      appId: "cli_yyy",
      appSecret: "s",
      openId: "o",
      configPath: configPath(),
    })
    expect(r.accountId).toBe("company-a")
    const config = loadConfig(configPath())
    expect(config.accounts["company-a"]).toBeDefined()
    expect(config.accounts["company-a"]?.appId).toBe("cli_yyy")
  })

  test("重复保存同 accountId → 覆盖 + 保留扩展字段", () => {
    saveAccount({
      domain: "feishu",
      appId: "cli_a",
      appSecret: "old",
      openId: "ou_a",
      configPath: configPath(),
    })
    // 手动 patch 一些扩展字段
    const c1 = loadConfig(configPath())
    if (c1.accounts["cli_a"]) {
      c1.accounts["cli_a"].systemPrompt = "patched-prompt"
      c1.accounts["cli_a"].requireMention = false
    }
    saveConfig(c1, configPath())

    // 重新 saveAccount(模拟 user 重新扫码 reauth)
    saveAccount({
      domain: "feishu",
      appId: "cli_a",
      appSecret: "new",
      openId: "ou_a",
      configPath: configPath(),
    })
    const c2 = loadConfig(configPath())
    expect(c2.accounts["cli_a"]?.systemPrompt).toBe("patched-prompt") // 保留
    expect(c2.accounts["cli_a"]?.requireMention).toBe(false) // 保留
    // appSecret 已更新
    if (c2.accounts["cli_a"]) {
      expect(readSecret(c2.accounts["cli_a"].appSecret)).toBe("new")
    }
  })

  test("Lark 域名 + 多账号", () => {
    saveAccount({
      domain: "feishu",
      appId: "cli_cn",
      appSecret: "s_cn",
      openId: "ou_cn",
      configPath: configPath(),
    })
    saveAccount({
      domain: "lark",
      appId: "cli_intl",
      appSecret: "s_intl",
      openId: "ou_intl",
      configPath: configPath(),
    })
    const config = loadConfig(configPath())
    expect(Object.keys(config.accounts)).toHaveLength(2)
    expect(config.accounts["cli_cn"]?.domain).toBe("feishu")
    expect(config.accounts["cli_intl"]?.domain).toBe("lark")
  })

  test("配置文件权限 0600(POSIX)", () => {
    if (platform() === "win32") return
    saveAccount({
      domain: "feishu",
      appId: "cli_perm",
      appSecret: "s",
      openId: "o",
      configPath: configPath(),
    })
    const stat = statSync(configPath())
    expect(stat.mode & 0o777).toBe(0o600)
  })
})

// ============================================================
// listAccounts
// ============================================================

describe("listAccounts", () => {
  test("空 → 空数组", () => {
    expect(listAccounts(configPath())).toEqual([])
  })

  test("3 账号 → 3 entries", () => {
    saveAccount({
      domain: "feishu",
      appId: "a",
      appSecret: "sa",
      openId: "oa",
      configPath: configPath(),
    })
    saveAccount({
      domain: "feishu",
      appId: "b",
      appSecret: "sb",
      openId: "ob",
      configPath: configPath(),
    })
    saveAccount({
      domain: "lark",
      appId: "c",
      appSecret: "sc",
      openId: "oc",
      configPath: configPath(),
    })
    const list = listAccounts(configPath())
    expect(list).toHaveLength(3)
    expect(list.map((x) => x.accountId).sort()).toEqual(["a", "b", "c"])
  })
})

// ============================================================
// deleteAccount
// ============================================================

describe("deleteAccount", () => {
  test("删存在 account → true + 真删", () => {
    saveAccount({
      domain: "feishu",
      appId: "tobedeleted",
      appSecret: "s",
      openId: "o",
      configPath: configPath(),
    })
    expect(listAccounts(configPath())).toHaveLength(1)
    const r = deleteAccount("tobedeleted", configPath())
    expect(r).toBe(true)
    expect(listAccounts(configPath())).toHaveLength(0)
  })

  test("删不存在 → false(idempotent)", () => {
    expect(deleteAccount("never-existed", configPath())).toBe(false)
  })
})

// ============================================================
// updateAccountSettings (Partial settings)
// [feat: feishu-create-group-toggle-gui] 2026-05-24
// ============================================================

describe("updateAccountSettings", () => {
  function seedAccount(id: string) {
    saveAccount({
      accountId: id,
      domain: "feishu",
      appId: id,
      appSecret: "s",
      openId: "o",
      configPath: configPath(),
    })
  }

  // [feat: feishu-group-new-cmd-and-mention-rename] 2026-05-25
  // 原"只 patch enableAutoGroupCreate" / "model + flag 同时 patch" 两 case 删 — flag 已删
  test("只 patch requireMention → flag 更新,其他字段不动", () => {
    seedAccount("acc1")
    const before = loadConfig(configPath()).accounts["acc1"]
    expect(before.requireMention).toBe(true) // 默认 true
    expect(before.model).toBeUndefined()
    expect(before.appSecret).toBeDefined()

    const r = updateAccountSettings("acc1", { requireMention: false }, configPath())
    expect(r).toBe(true)

    const after = loadConfig(configPath()).accounts["acc1"]
    expect(after.requireMention).toBe(false)
    expect(after.model).toBeUndefined()
    expect(after.appSecret).toEqual(before.appSecret)
    expect(after.agent).toEqual(before.agent)
    expect(after.threadSession).toEqual(before.threadSession)
  })

  test("只 patch model → model 更新,requireMention 不动", () => {
    seedAccount("acc2")
    updateAccountSettings("acc2", { requireMention: false }, configPath())

    const r = updateAccountSettings(
      "acc2",
      { model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" } },
      configPath(),
    )
    expect(r).toBe(true)

    const after = loadConfig(configPath()).accounts["acc2"]
    expect(after.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-6" })
    expect(after.requireMention).toBe(false) // 先前 false 保留
  })

  test("同时 patch model + requireMention → 两者都更新", () => {
    seedAccount("acc3")
    const r = updateAccountSettings(
      "acc3",
      {
        model: { providerID: "openai", modelID: "gpt-4" },
        requireMention: false,
      },
      configPath(),
    )
    expect(r).toBe(true)

    const after = loadConfig(configPath()).accounts["acc3"]
    expect(after.model).toEqual({ providerID: "openai", modelID: "gpt-4" })
    expect(after.requireMention).toBe(false)
  })

  test("model: null → 清除 model 字段(走 user default)", () => {
    seedAccount("acc4")
    updateAccountSettings(
      "acc4",
      { model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" } },
      configPath(),
    )
    expect(loadConfig(configPath()).accounts["acc4"].model).toBeDefined()

    const r = updateAccountSettings("acc4", { model: null }, configPath())
    expect(r).toBe(true)
    expect(loadConfig(configPath()).accounts["acc4"].model).toBeUndefined()
  })

  test("空 patch ({}) → 仍 true(noop 不挂,跟旧 updateAccountModel(null) 行为对齐)", () => {
    seedAccount("acc5")
    const before = loadConfig(configPath()).accounts["acc5"]
    const r = updateAccountSettings("acc5", {}, configPath())
    expect(r).toBe(true)
    const after = loadConfig(configPath()).accounts["acc5"]
    expect(after).toEqual(before)
  })

  test("account 不存在 → false", () => {
    const r = updateAccountSettings(
      "never-existed",
      { requireMention: false },
      configPath(),
    )
    expect(r).toBe(false)
  })

  // [feat: feishu-group-new-cmd-and-mention-rename] 2026-05-25
  // 原 "toggle flag false → true → false 持久化" 测试改用 requireMention(enableAutoGroupCreate 已删)
  test("toggle requireMention true → false → true 持久化(取代旧 enableAutoGroupCreate toggle 测试)", () => {
    seedAccount("acc6")
    expect(loadConfig(configPath()).accounts["acc6"].requireMention).toBe(true)

    updateAccountSettings("acc6", { requireMention: false }, configPath())
    expect(loadConfig(configPath()).accounts["acc6"].requireMention).toBe(false)

    updateAccountSettings("acc6", { requireMention: true }, configPath())
    expect(loadConfig(configPath()).accounts["acc6"].requireMention).toBe(true)
  })

  test("model + requireMention 同时改 → 都更新", () => {
    seedAccount("acc_rm2")
    const r = updateAccountSettings(
      "acc_rm2",
      {
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
        requireMention: false,
      },
      configPath(),
    )
    expect(r).toBe(true)

    const after = loadConfig(configPath()).accounts["acc_rm2"]
    expect(after.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-6" })
    expect(after.requireMention).toBe(false)
  })

  test("toggle requireMention true → false → true 持久化", () => {
    seedAccount("acc_rm3")
    expect(loadConfig(configPath()).accounts["acc_rm3"].requireMention).toBe(true)

    updateAccountSettings("acc_rm3", { requireMention: false }, configPath())
    expect(loadConfig(configPath()).accounts["acc_rm3"].requireMention).toBe(false)

    updateAccountSettings("acc_rm3", { requireMention: true }, configPath())
    expect(loadConfig(configPath()).accounts["acc_rm3"].requireMention).toBe(true)
  })
})

// ============================================================
// updateAccountModel (向后兼容 thin wrapper)
// ============================================================

describe("updateAccountModel(向后兼容)", () => {
  test("传 model 对象 → 走 updateAccountSettings,model 更新", () => {
    saveAccount({
      accountId: "compat1",
      domain: "feishu",
      appId: "a",
      appSecret: "s",
      openId: "o",
      configPath: configPath(),
    })
    const r = updateAccountModel(
      "compat1",
      { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      configPath(),
    )
    expect(r).toBe(true)
    expect(loadConfig(configPath()).accounts["compat1"].model).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-6",
    })
  })

  test("传 null → 清 model", () => {
    saveAccount({
      accountId: "compat2",
      domain: "feishu",
      appId: "a",
      appSecret: "s",
      openId: "o",
      configPath: configPath(),
    })
    updateAccountModel(
      "compat2",
      { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      configPath(),
    )
    const r = updateAccountModel("compat2", null, configPath())
    expect(r).toBe(true)
    expect(loadConfig(configPath()).accounts["compat2"].model).toBeUndefined()
  })

  test("account 不存在 → false", () => {
    const r = updateAccountModel(
      "never-existed",
      { providerID: "p", modelID: "m" },
      configPath(),
    )
    expect(r).toBe(false)
  })
})
