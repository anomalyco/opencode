// [fork-only] reply-actions — feishu-bridge-light 纯函数 helper
// [feat: feishu-bridge-light] 2026-05-23
// [feat: feishu-group-slash-command] 2026-05-24 — 删 [CREATE_GROUP:name] marker / parseCreateGroupShortForm / 改写 isGroupCreationIntent
//
// 收纳本 feat 的可单测纯函数,跟 message-pipeline.ts 的 IO/状态隔离:
//   - stripMentions — 从 text 里 strip 飞书 @mention 标记(/new 检测前用)
//   - parseAttachMarkers — AI reply 里 [ATTACH:path] marker
//   - classifyAttachment — 扩展名 → image/file/reject 分流 + 路径白名单校验
//   - parseGroupCommand — `/group <群名>` slash command 解析(feishu-group-slash-command)
//   - isGroupCreationIntent — 自然语言建群意图白名单检测(降级为 /group 引导用)

import { homedir } from "node:os"
import { extname, isAbsolute, join, resolve, sep } from "node:path"

/** ImMessageEvent.mentions 的子集 — 只用到 key 字段,decouple wss-client 直接依赖 */
export interface MentionRef {
  key: string
  name: string
  openId?: string
}

/**
 * 从 text 里把所有 @mention 标记 strip 掉,然后 trim。
 *
 * 飞书 IM 在 text content 里把 `@bot` 渲染成形如 `@_user_1 ...` 的占位,对应
 * `mentions[].key === "_user_1"`。`/new` 在群里以 `@bot /new` 发出时,需先 strip mention
 * 才能识别字面值。私聊里没 @ 标记,strip 后等于 trim。
 *
 * key 里理论上不含 regex 特殊字符(飞书形态 `_user_N`),但防御性转义保险。
 */
export function stripMentions(text: string, mentions: ReadonlyArray<MentionRef>): string {
  let out = text
  for (const m of mentions) {
    const escaped = m.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    out = out.replace(new RegExp(`@${escaped}\\s*`, "g"), "")
  }
  return out.trim()
}

// ============================================================
// [ATTACH:path] marker (Phase 2)
// ============================================================

/** 飞书 file.create 支持的 file_type 枚举 — 其它扩展名走 stream 兜底 */
export type LarkFileType = "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream"

/** 默认 workspace 根 — 所有 ATTACH 路径必须在此子树内才允许上传 */
export const IMBOT_WORKSPACE_ROOT = join(homedir(), ".opencode", "imbot-workspace")

/** 走 image.create 的扩展名(返回 image_key,≤10MB) */
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".ico"])

/** 扩展名 → 飞书 file_type SDK 枚举(未列扩展名走 stream 兜底) */
const FILE_TYPE_MAP: Record<string, LarkFileType> = {
  ".pdf": "pdf",
  ".doc": "doc",
  ".xls": "xls",
  ".ppt": "ppt",
  ".mp4": "mp4",
  ".opus": "opus",
}

const ATTACH_MARKER_RE = /\[ATTACH:([^\]]+)\]/g

export interface ParsedMarkers {
  paths: string[]
  cleanText: string
}

/**
 * 解析 reply 里所有 `[ATTACH:path]` marker。
 *
 * - paths:按出现顺序,trim 后的路径串(可包含相对路径 / 越界路径 — 校验交给 classifyAttachment)
 * - cleanText:strip 所有 marker 后的文本;残留行尾空格 + 多余空行做基础清理后 trim
 */
export function parseAttachMarkers(text: string): ParsedMarkers {
  const paths: string[] = []
  for (const m of text.matchAll(ATTACH_MARKER_RE)) {
    const p = m[1]?.trim()
    if (p) paths.push(p)
  }
  const cleanText = stripMarkers(text, ATTACH_MARKER_RE)
  return { paths, cleanText }
}

/** strip 一种 marker + 清行尾空格 + 收敛空行 + trim */
function stripMarkers(text: string, re: RegExp): string {
  return text
    .replace(re, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export type AttachClassification =
  | { kind: "image" }
  | { kind: "file"; fileType: LarkFileType }
  | { kind: "reject"; reason: string }

/**
 * 给一个路径分类:image / file(含 fileType)/ reject(含原因)。
 *
 * 安全约束(防 LLM 把 `/etc/passwd` 发出去):
 * - 必须是绝对路径
 * - resolve 后必须在 workspaceRoot 子树内
 *
 * @param path 来自 LLM reply 的 `[ATTACH:xxx]` 解析串
 * @param workspaceRoot 默认 `~/.opencode/imbot-workspace`,单测可覆盖
 */
export function classifyAttachment(
  path: string,
  workspaceRoot: string = IMBOT_WORKSPACE_ROOT,
): AttachClassification {
  if (!isAbsolute(path)) {
    return { kind: "reject", reason: "非绝对路径" }
  }
  const norm = resolve(path)
  const rootWithSep = workspaceRoot.endsWith(sep) ? workspaceRoot : workspaceRoot + sep
  if (norm !== workspaceRoot && !norm.startsWith(rootWithSep)) {
    return { kind: "reject", reason: `在 workspace 外(${workspaceRoot})` }
  }
  const ext = extname(norm).toLowerCase()
  if (IMAGE_EXTS.has(ext)) {
    return { kind: "image" }
  }
  return { kind: "file", fileType: FILE_TYPE_MAP[ext] ?? "stream" }
}

// ============================================================
// /group slash command 解析 + 自然语言建群意图白名单
// [feat: feishu-group-slash-command] 2026-05-24
// ============================================================
//
// 起因:之前的自然语言 regex(`feishu-create-group-hard-block`)虽然 provider-agnostic
// 但宽容 regex `/(?:开|建|创建|新建|拉|搞|做)[^群]{0,20}群/` 误拦"如何建群" /
// "建立群体精神" / "新群规" 等查询/陈述,user 反馈不可接受。
//
// 改造:
//   1. **主路径** `/group <名字>` slash command 显式触发 — 0 误触 / 0 LLM 调用 /
//      provider-agnostic / 跟 `/new` 一致
//   2. **回退引导**:自然语言关键字 regex 替换为**白名单短语**(中文 14 + 英文 4)+
//      **查询后缀排除兜底**,误拦率显著降低;命中不走 LLM 直接 reply 引导 user 用 /group
//
// 删除的旧路径:
//   - [CREATE_GROUP:name] LLM marker(provider 跳过 system prompt 时完全失效)
//   - parseCreateGroupShortForm 半结构化"建群 X" 路径(UX 跟 /group 重叠混淆源)

/**
 * `/group <群名>` 命令解析结果。
 *
 * - `matched: false` — text 不是 /group 命令(`/groupabc` 粘连 / `/Group X` 大写 / 完全无关文本)
 * - `matched: true, groupName: "X"` — 解析成功
 * - `matched: true, groupName: null, error: "no_name"` — `/group` 无参数
 * - `matched: true, groupName: null, error: "too_long"` — 群名超 30 字符
 */
export interface GroupCommandParseResult {
  matched: boolean
  groupName: string | null
  error?: "no_name" | "too_long"
}

/** 飞书 chat name 上限 30 字符 — 主动拒绝信息友好,而非后端抛错 */
export const GROUP_NAME_MAX_LEN = 30

/**
 * 解析 `/group <群名>` slash command。
 *
 * 命中条件:
 *   - text trim 后以 "/group " 开头 OR 等于 "/group"
 *   - 大小写敏感(跟 /new 一致 `/Group X` 不命中)
 *
 * 群名规则:
 *   - 允许中文 / 英文 / 数字 / `-` / `_` / 内部空格
 *   - 长度 1 ≤ name.length ≤ 30(GROUP_NAME_MAX_LEN)
 *
 * 输入约定:调用方先 strip mention,本 helper 不做 mention 处理。
 */
export function parseGroupCommand(text: string): GroupCommandParseResult {
  if (!text || typeof text !== "string") return { matched: false, groupName: null }
  const trimmed = text.trim()
  if (trimmed === "/group") {
    return { matched: true, groupName: null, error: "no_name" }
  }
  if (!trimmed.startsWith("/group ")) {
    return { matched: false, groupName: null }
  }
  const name = trimmed.slice("/group ".length).trim()
  if (!name) return { matched: true, groupName: null, error: "no_name" }
  if (name.length > GROUP_NAME_MAX_LEN) {
    return { matched: true, groupName: null, error: "too_long" }
  }
  return { matched: true, groupName: name }
}

/**
 * 中文建群短语白名单(Tier 1 + Tier 2,user 拍板 2026-05-24)。
 *
 * Tier 1:核心动宾短语(精准度极高)
 * Tier 2:加量词口语变体(精准,常用)
 *
 * 改这个列表前需 user 同意 — 这是 hard-block 行为面的精确性来源。
 */
const GROUP_CREATION_PHRASES_ZH = [
  // Tier 1(4)
  "建群",
  "创建群",
  "新建群",
  "拉群",
  // Tier 2(10)— 加量词口语变体
  "建个群",
  "建一个群",
  "创建个群",
  "创建一个群",
  "新建个群",
  "新建一个群",
  "拉个群",
  "拉一个群",
  "开个群",
  "开一个群",
] as const

/** 英文建群短语 — lowercase 比较 */
const GROUP_CREATION_PHRASES_EN = [
  "create a group",
  "make a group",
  "start a group",
  "new group",
] as const

/**
 * 中文查询后缀排除 — 命中短语但 user 是在查询/讨论建群,不是真要建群。
 * 例:"建群怎么操作" 含"建群" 但 user 是问操作方法,放走给 LLM 处理。
 */
const QUERY_SUFFIXES_ZH = [
  "怎么",
  "如何",
  "方法",
  "步骤",
  "流程",
  "教程",
  "为什么",
] as const

/**
 * 英文 `new group` 专用排除 — 防"new group rule" / "new group of users" 等 noun
 * phrase 误拦。命中 "new group" 时,如果后面紧跟这些 token 之一,放走给 LLM。
 */
const NEW_GROUP_EXCLUDE_TOKENS = [
  " rule",
  " of ",
  " policy",
  " chat",
  " channel",
  " members",
  " settings",
] as const

/** 英文通用查询后缀 — "create a group how" 等 */
const QUERY_SUFFIXES_EN = [" how", " how to"] as const

/**
 * 判断 user message 是否含建群意图(白名单短语命中 + 查询后缀排除兜底)。
 *
 * 输入约定:调用方负责先 strip mention,输入是已 clean 的 text。空 / 非字符串返 false。
 *
 * 命中规则:
 *   1. 含任一中文白名单短语 → 命中候选;若同时含中文查询后缀 → 排除,返 false
 *   2. 含任一英文白名单短语 → 命中候选;若同时含英文查询后缀 → 排除,返 false
 *   3. 含 "new group" → 额外检查 NEW_GROUP_EXCLUDE_TOKENS(如紧跟 " rule" 等)→ 排除
 *
 * 用法:pipeline 检测到命中 → 不调 LLM,reply 引导 user 用 /group <群名>。
 */
export function isGroupCreationIntent(text: string): boolean {
  if (!text || typeof text !== "string") return false

  const zhHit = GROUP_CREATION_PHRASES_ZH.some((p) => text.includes(p))
  const lower = text.toLowerCase()
  const enHit = GROUP_CREATION_PHRASES_EN.some((p) => lower.includes(p))

  if (!zhHit && !enHit) return false

  // 排除规则按命中语言分别检查
  if (zhHit) {
    if (QUERY_SUFFIXES_ZH.some((s) => text.includes(s))) return false
  }
  if (enHit) {
    if (QUERY_SUFFIXES_EN.some((s) => lower.includes(s))) return false
    // "new group" 专用 noun-phrase 排除(rule / of / policy 等)
    if (lower.includes("new group")) {
      if (NEW_GROUP_EXCLUDE_TOKENS.some((s) => lower.includes("new group" + s))) {
        return false
      }
    }
  }
  return true
}

// ============================================================
// 群消息 @ bot 检测 — requireMention enforcement
// [feat: feishu-group-mention-policy] 2026-05-24
// ============================================================

/**
 * 判断 user 消息的 mentions 是否含 bot 本人。
 *
 * **关键 — 2026-05-24 user 实测发现的设计错误纠正**:
 * `account.openId` 是 **OAuth 主用户(绑账号的人)** 的 openId,**不是 bot 的**;
 * `mentions[].openId` 是被 @ 实体的 openId(@ bot 时是 bot 自己的)。两者维度
 * 不同,openId 比较**永远不命中**。所以改用 **botName** 匹配
 * `mentions[].name === botName` 判断 bot 是否被 @。
 *
 * 输入:event.mentions[] 数组、bot 的 display name(来自 `account.botName`)
 * 输出:true = bot 被 @,false = 没被 @ / mentions 空 / botName 不匹配
 *
 * 用法:pipeline 群消息处理 `requireMention=true`(默认)时,验证 bot 是否被 @
 * 决定是否走 LLM 响应。p2p 私聊不调用此 helper(私聊总是响应)。
 *
 * 防御性:botName 空串(`fetchBotName` 失败导致)→ 返 **true**(**fail open**,
 * 当作被 @ 让 user 不困惑,避免吞掉所有群消息)。
 *
 * **后续 backlog**(更稳健):扩 `fetchBotInfo` 拉 bot 自己的 open_id 存
 * `account.botOpenId`,改 helper 优先 openId 匹配,fallback botName。
 * 当前 botName 实现已覆盖 95%+ 场景(user 不会经常改 bot 显示名)。
 */
export function isBotMentioned(
  mentions: ReadonlyArray<MentionRef>,
  botName: string,
): boolean {
  // botName 缺失 → fail open(当作被 @,避免吞掉所有群消息)
  if (!botName) return true
  return mentions.some((m) => m.name === botName)
}
