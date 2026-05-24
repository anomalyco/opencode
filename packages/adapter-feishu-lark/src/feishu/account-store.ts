// [fork-only] 飞书账号配置文件持久化(SecretRef 三档凭证)
// [feat: feishu-bridge] 2026-05-08
//
// 配置文件位置:~/.opencode/feishu-config.json
// 结构:FeishuAdapterConfig(spec §4.4)— accounts map<accountId, FeishuAccount>
// appSecret 写盘走 SecretRef:
//   - macOS / Linux:默认 file mode → ~/.opencode/feishu-secrets/<accountId>.key(0600)
//   - Windows:默认 plaintext(暂)
// JSON 主文件存 SecretRef pointer,真 secret 存独立 0600 文件,泄漏单文件不暴露 secret

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import {
  emptyConfig,
  FeishuAdapterConfigSchema,
  type FeishuAccount,
  type FeishuAdapterConfig,
  type FeishuDomain,
} from "../core/config-schema"
import {
  defaultMode,
  defaultFilePath,
  writeSecret,
  type SecretRef,
} from "../core/secret-ref"

// ============================================================
// 路径
// ============================================================

/** 默认配置文件路径(~/.opencode/feishu-config.json)*/
export function defaultConfigPath(): string {
  return join(homedir(), ".opencode", "feishu-config.json")
}

// ============================================================
// 读
// ============================================================

/**
 * 读 ~/.opencode/feishu-config.json,如不存在返默认空配置。
 *
 * 解析失败也返默认配置(并 warn),避免坏配置阻塞 adapter 启动。
 */
export function loadConfig(path: string = defaultConfigPath()): FeishuAdapterConfig {
  if (!existsSync(path)) {
    return emptyConfig()
  }
  try {
    const raw = readFileSync(path, "utf-8")
    const json = JSON.parse(raw) as unknown
    return FeishuAdapterConfigSchema.parse(json)
  } catch (err) {
    console.warn(`[account-store] failed to parse ${path}, fallback empty:`, err)
    return emptyConfig()
  }
}

// ============================================================
// 写
// ============================================================

/** 原子写 JSON(写临时文件 + rename,避免 partial write)*/
function atomicWriteJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 })
  // rename 是 atomic on POSIX
  // node fs.renameSync 可能在 Windows 跨盘失败,但同盘正常
  const fs = require("node:fs")
  fs.renameSync(tmp, path)
}

export function saveConfig(
  config: FeishuAdapterConfig,
  path: string = defaultConfigPath(),
): void {
  atomicWriteJson(path, config)
}

// ============================================================
// 添加 / 更新账号(C1.6 主入口)
// ============================================================

export interface SaveAccountInput {
  /** 账号 id(自定的标识,通常用 appId)。省 = 用 appId */
  accountId?: string
  domain: FeishuDomain
  appId: string
  appSecret: string // 明文,本函数内自动落到 SecretRef
  openId: string
  /** 飞书 bot 应用名(可选;saveAccount 时一次性拉,失败为空)*/
  botName?: string
  /** 可选:覆盖默认配置文件路径(测试用)*/
  configPath?: string
}

export interface SavedAccount {
  accountId: string
  account: FeishuAccount
}

/**
 * 把一个新绑定的飞书账号写盘:
 *   1. appSecret 通过 SecretRef 落盘(默认 file mode 0600)
 *   2. 配置文件 accounts 里加 entry(已存在 id 则覆盖)
 *
 * @returns { accountId, account }(account 含 SecretRef pointer,不含明文)
 */
export function saveAccount(input: SaveAccountInput): SavedAccount {
  const accountId = input.accountId ?? input.appId
  const configPath = input.configPath ?? defaultConfigPath()
  const config = loadConfig(configPath)

  // SecretRef 落盘
  const secretRef: SecretRef = writeSecret(input.appSecret, {
    mode: defaultMode(),
    id: accountId,
  })

  // 构造 / 更新 account(沿用已存在的 group config / heartbeat 等)
  const existing = config.accounts[accountId]
  const account: FeishuAccount = {
    enabled: existing?.enabled ?? true,
    appId: input.appId,
    appSecret: secretRef,
    openId: input.openId,
    botName: input.botName ?? existing?.botName,
    domain: input.domain,
    connectionMode: "websocket",
    requireMention: existing?.requireMention ?? true,
    dmPolicy: existing?.dmPolicy ?? "allowlist",
    allowFrom: existing?.allowFrom ?? [],
    groupPolicy: existing?.groupPolicy ?? "allowlist",
    groupAllowFrom: existing?.groupAllowFrom ?? [],
    groups: existing?.groups ?? {},
    // 飞书桥接默认绑 "imbot" agent(DeskFox setup hook 注入的安全 agent,同 build 能力但 unattended 危险工具默认 ask)
    // 已有 account.agent(老 user 绑过 "build")保持不动 — user 自行在 edit dialog 切换
    agent: existing?.agent ?? "imbot",
    systemPrompt: existing?.systemPrompt,
    tools: existing?.tools,
    heartbeat: existing?.heartbeat,
    threadSession: existing?.threadSession ?? true,
    tables: existing?.tables ?? "bullets",
    blockStreamingCoalesce: existing?.blockStreamingCoalesce ?? 50,
    // [feat: feishu-bridge-light] 自动建群 opt-in,默认关
    enableAutoGroupCreate: existing?.enableAutoGroupCreate ?? false,
  }

  config.accounts[accountId] = account
  saveConfig(config, configPath)

  return { accountId, account }
}

// ============================================================
// 删除 / 列出
// ============================================================

export function listAccounts(
  configPath: string = defaultConfigPath(),
): Array<{ accountId: string; account: FeishuAccount }> {
  const config = loadConfig(configPath)
  return Object.entries(config.accounts).map(([accountId, account]) => ({
    accountId,
    account,
  }))
}

export function deleteAccount(
  accountId: string,
  configPath: string = defaultConfigPath(),
): boolean {
  const config = loadConfig(configPath)
  if (!(accountId in config.accounts)) return false
  delete config.accounts[accountId]
  saveConfig(config, configPath)
  return true
}

/**
 * 更新指定账号的 model 字段(向后兼容,thin wrapper 委派给 updateAccountSettings)。
 *
 * @param model {providerID, modelID} 设 model;`null` 清除(走 user default)
 * @returns 是否更新成功(account 不存在返 false)
 */
export function updateAccountModel(
  accountId: string,
  model: { providerID: string; modelID: string } | null,
  configPath: string = defaultConfigPath(),
): boolean {
  // FORK: feishu-create-group-toggle-gui(2026-05-24)— thin wrapper,实现迁移到 updateAccountSettings
  return updateAccountSettings(accountId, { model }, configPath)
}

/**
 * Partial 更新账号 settings — 当前支持 model + enableAutoGroupCreate 两个字段。
 *
 * **严格白名单**:只接受 patch 列出的字段;其他 schema 字段(appId/appSecret/openId/
 * tokenStore/agent/threadSession/tables/blockStreamingCoalesce 等)0 影响。
 * 未来扩 GUI 暴露新 flag 时,**只需扩这个函数的 patch 类型 + 增加对应处理分支**,
 * server endpoint 自动复用。
 *
 * @param patch model: 设/清(null = 清除走 default,undefined = 不动);
 *              enableAutoGroupCreate: true/false 都更新,undefined = 不动
 * @returns 是否更新成功(account 不存在返 false)
 *
 * [feat: feishu-create-group-toggle-gui] 2026-05-24
 */
export function updateAccountSettings(
  accountId: string,
  patch: {
    model?: { providerID: string; modelID: string } | null
    enableAutoGroupCreate?: boolean
    /** [feat: feishu-group-mention-policy] 2026-05-24 */
    requireMention?: boolean
  },
  configPath: string = defaultConfigPath(),
): boolean {
  const config = loadConfig(configPath)
  const account = config.accounts[accountId]
  if (!account) return false
  // 严格只 patch 白名单字段;undefined 表示不动
  if (patch.model !== undefined) {
    if (patch.model) {
      account.model = { providerID: patch.model.providerID, modelID: patch.model.modelID }
    } else {
      delete account.model
    }
  }
  if (patch.enableAutoGroupCreate !== undefined) {
    account.enableAutoGroupCreate = patch.enableAutoGroupCreate
  }
  if (patch.requireMention !== undefined) {
    account.requireMention = patch.requireMention
  }
  saveConfig(config, configPath)
  return true
}
