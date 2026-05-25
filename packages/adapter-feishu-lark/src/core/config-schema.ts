// [fork-only] adapter-feishu-lark 配置 schema(zod)
// [feat: feishu-bridge] 2026-05-08
//
// 参考 spec §4.4 + 借鉴 OpenClaw plugin config schema(详见调研产物)。
// 顶层 → 多账号 → 多群 → heartbeat / 各项策略。

import { z } from "zod"
import { SecretRefSchema } from "./secret-ref"

// ============================================================
// 子 schema
// ============================================================

/** 飞书 / Lark 域名分组(spec §1) */
export const FeishuDomainSchema = z.enum(["feishu", "lark"])
export type FeishuDomain = z.infer<typeof FeishuDomainSchema>

/** 私聊策略 */
export const DmPolicySchema = z.enum(["allowlist", "any"])
export type DmPolicy = z.infer<typeof DmPolicySchema>

/** 群组策略 */
export const GroupPolicySchema = z.enum(["allowlist", "any"])
export type GroupPolicy = z.infer<typeof GroupPolicySchema>

/** 回复模式(MVP 不区分 direct/group,好用版扩展) */
export const ReplyModeSchema = z.enum(["auto", "static", "streaming"])
export type ReplyMode = z.infer<typeof ReplyModeSchema>

/** Markdown 表格降级策略(spec G4) */
export const TableStrategySchema = z.enum(["off", "bullets", "code"])
export type TableStrategy = z.infer<typeof TableStrategySchema>

// ============================================================
// 群级独立配置(spec G8)
// ============================================================

export const FeishuGroupConfigSchema = z.object({
  /** 是否启用此群 */
  enabled: z.boolean().default(true),
  /** 群级 system prompt(覆盖账号级)*/
  systemPrompt: z.string().optional(),
  /** 工具白名单(子集);空 = 跟随账号级 */
  tools: z.array(z.string()).optional(),
  /** skills 白名单(D5 plugin slot,v1 不内置任何 skill,留接口) */
  skills: z.array(z.string()).optional(),
  /** 回复模式(direct vs group 不同体验) */
  replyMode: ReplyModeSchema.optional(),
  /** Markdown 表格降级 */
  tables: TableStrategySchema.optional(),
})

export type FeishuGroupConfig = z.infer<typeof FeishuGroupConfigSchema>

// ============================================================
// heartbeat 主动消息(spec G12)
// ============================================================

export const FeishuHeartbeatSchema = z.object({
  enabled: z.boolean().default(false),
  /** cron 表达式(node-cron 风格),如 "0 9 * * 1-5"(工作日 9 点) */
  schedule: z.string().min(1).optional(),
  /** activeHours 限制,如 "9-18"(只在工作时间内允许 trigger) */
  activeHours: z.string().regex(/^\d{1,2}-\d{1,2}$/).optional(),
  /** 主动消息内容(可含模板变量,future-extend) */
  message: z.string().optional(),
  /** 发送目标:openId 或 chatId 列表 */
  targets: z.array(z.string()).default([]),
})

export type FeishuHeartbeat = z.infer<typeof FeishuHeartbeatSchema>

// ============================================================
// 单账号配置(spec G7 多账号)
// ============================================================

export const FeishuAccountSchema = z.object({
  /** 账号是否启用 */
  enabled: z.boolean().default(true),
  /** 飞书应用 appId(OAuth Device Flow 拿到) */
  appId: z.string().min(1),
  /** 飞书应用 appSecret(SecretRef 三档存储) */
  appSecret: SecretRefSchema,
  /** 主用户 openId */
  openId: z.string().min(1),
  /** 飞书 bot 应用名(显示用,saveAccount 时拉一次落盘;空字符串表未拉到 / 网络失败) */
  botName: z.string().optional(),
  /** 域名:feishu(国内) / lark(国际)*/
  domain: FeishuDomainSchema,
  /** 长连接模式(锁定 websocket) */
  connectionMode: z.literal("websocket").default("websocket"),
  /** 是否需要 @ 触发(群里) */
  requireMention: z.boolean().default(true),
  /** 私聊策略 */
  dmPolicy: DmPolicySchema.default("allowlist"),
  /** 私聊白名单 openId */
  allowFrom: z.array(z.string()).default([]),
  /** 群组策略 */
  groupPolicy: GroupPolicySchema.default("allowlist"),
  /** 群白名单 openId(允许这些 user 在群里 @ 触发) */
  groupAllowFrom: z.array(z.string()).default([]),
  /** 群级独立配置(key = chatId,value = 群配置)*/
  groups: z.record(z.string(), FeishuGroupConfigSchema).default(() => ({})),
  /** 副用户绑定码池(运行时 in-memory,不写盘 — 这里 schema 仅占位) */
  // secondaryBindingCodes 不进 schema(运行时状态)
  /**
   * opencode agent 名(默认 "imbot" — DeskFox setup hook 注入的安全 agent,
   * 同 build 能力但 unattended 危险工具默认 ask)。
   *
   * **GUI 故意不暴露此字段** — 普通用户走默认 imbot,自然受安全防线约束。
   * **研发能力的 user 可通过编辑 ~/.opencode/feishu-config.json 改此字段 opt-out**
   * 走自定义 agent(开源软件"默认安全 + 显式 opt-out"范式,跟 Linux root / Docker
   * `--privileged` 同款)。schema 故意保留 z.string() 不锁 z.literal("imbot") —
   * 不阻挠合法 power user 自定义需求。
   *
   * 详 OPENCODE-PLAN 仓 `架构决策/im桥接-imbot单一架构.md` §1.1。
   */
  agent: z.string().default("imbot"),
  /**
   * per-account 模型选择(可选)。
   * 不设 → plugin promptAsync 不传 model → opencode 用 user 全局 default。
   * 设了 → plugin promptAsync 显式用此 model。
   */
  model: z
    .object({
      providerID: z.string().min(1),
      modelID: z.string().min(1),
    })
    .optional(),
  /** 系统 prompt(账号级,默认 empty 用 opencode default) */
  systemPrompt: z.string().optional(),
  /** 工具白名单(账号级)*/
  tools: z.array(z.string()).optional(),
  /** heartbeat 配置(账号级) */
  heartbeat: FeishuHeartbeatSchema.optional(),
  /** 是否启用 threadSession(spec G11) */
  threadSession: z.boolean().default(true),
  /** Markdown 表格策略(账号级,可被群级覆盖)*/
  tables: TableStrategySchema.default("bullets"),
  /** 短 token 流式聚合阈值(ms)(spec G3),默认 50 */
  blockStreamingCoalesce: z.number().int().min(0).max(1000).default(50),
  // [feat: feishu-group-new-cmd-and-mention-rename] 2026-05-25 — 删 enableAutoGroupCreate 死开关
  // 老配置文件含此字段也 OK,zod 默认 strip unknown(无 migration 风险)。
  // 建群现在统一走 user 显式 /group <群名> 命令(feishu-group-slash-command),不再有 opt-in flag。
})

export type FeishuAccount = z.infer<typeof FeishuAccountSchema>

// ============================================================
// 顶层 adapter 配置
// ============================================================

export const FeishuAdapterConfigSchema = z.object({
  version: z.literal(1).default(1),
  /** 多账号(spec G7);key = accountId(user 自定的标识,如 "company-a") */
  accounts: z.record(z.string(), FeishuAccountSchema).default(() => ({})),
  /** 全局开关:暂停所有飞书(tray 菜单"暂停飞书桥接"控制) */
  paused: z.boolean().default(false),
  /** 调试:日志级别 */
  logLevel: z.enum(["error", "warn", "info", "debug", "trace"]).default("info"),
})

export type FeishuAdapterConfig = z.infer<typeof FeishuAdapterConfigSchema>

// ============================================================
// 默认空配置 + 工具函数
// ============================================================

export function emptyConfig(): FeishuAdapterConfig {
  return FeishuAdapterConfigSchema.parse({})
}

/**
 * 安全 parse:解析失败返 error 信息(给 GUI 提示),不抛异常。
 *
 * @param raw JSON 解出来的对象
 * @returns 成功 { ok: true, data } / 失败 { ok: false, error }
 */
export function safeParseConfig(
  raw: unknown,
):
  | { ok: true; data: FeishuAdapterConfig }
  | { ok: false; error: string } {
  const r = FeishuAdapterConfigSchema.safeParse(raw)
  if (r.success) return { ok: true, data: r.data }
  // 简化错误信息:只取首个 issue 的 path + message
  const first = r.error.issues[0]
  if (!first) return { ok: false, error: "unknown parse error" }
  const path = first.path.length > 0 ? first.path.join(".") : "(root)"
  return { ok: false, error: `${path}: ${first.message}` }
}

/**
 * 群级 effective 配置:merge 账号级 → 群级(群级覆盖账号级)。
 */
export function effectiveGroupConfig(
  account: FeishuAccount,
  chatId: string,
): {
  enabled: boolean
  systemPrompt: string | undefined
  tools: string[] | undefined
  skills: string[] | undefined
  replyMode: ReplyMode
  tables: TableStrategy
} {
  const group = account.groups[chatId]
  return {
    enabled: group?.enabled ?? true,
    systemPrompt: group?.systemPrompt ?? account.systemPrompt,
    tools: group?.tools ?? account.tools,
    skills: group?.skills,
    replyMode: group?.replyMode ?? "auto",
    tables: group?.tables ?? account.tables,
  }
}
