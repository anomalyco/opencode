// [fork-only] message-pipeline — 飞书消息 → opencode plugin client → 飞书回写
// [feat: feishu-bridge] 2026-05-09 v3(plugin 模式)
//
// v3 切到 opencode plugin 架构(对齐 OpenClaw channel plugin):
//   - opencodeClient 来自 PluginInput.client(in-process,自动 attach instance)
//   - LLM 响应通过 PromptDispatcher(plugin event hook 推送),不再手写 SSE
//   - 0 修改 opencode / DeskFox 主程序
//
// 流程:
//   1. WSS 收到 ImMessageEvent(messageType="text")
//   2. 解析 text + chatId → opencode session map(threadSession 1:1)
//   3. opencodeClient.session.create({ title })— 首次
//   4. dispatcher.register(sessionID) → 拿到 reply Promise
//   5. opencodeClient.session.promptAsync({ sessionID, agent, parts })
//   6. await replyPromise(dispatcher 累积 token,session.idle 时 resolve)
//   7. lark Client.im.v1.message.create 发回飞书

import { homedir } from "node:os"
import { join } from "node:path"
import { Client } from "@larksuiteoapi/node-sdk"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { FeishuAccount } from "../core/config-schema"
import { readSecret } from "../core/secret-ref"
import type { ChatSessionStore } from "./chat-session-store"
import {
  ConfirmCardController,
  type ParsedConfirmAction,
} from "./confirm-card"
import { createGroup, getShareLink } from "./group-creator"
import {
  PermissionCardController,
  type ParsedCardAction,
  type PermissionRequest,
} from "./permission-card"
import {
  sendFileMessage,
  sendImageMessage,
  uploadFile,
  uploadImage,
} from "./file-uploader"
import type { PromptDispatcher } from "./prompt-dispatcher"
import {
  classifyAttachment,
  extractGroupName,
  isBotMentioned,
  isGroupCreationIntent,
  parseAttachMarkers,
  parseCreateGroupMarkers,
  stripMentions,
} from "./reply-actions"
import type { ImMessageEvent } from "./wss-client"

/** opencode SDK v1 client 类型(plugin PluginInput.client 类型) */
export type OpencodeSDKClient = ReturnType<typeof createOpencodeClient>

/**
 * 飞书桥接专用 workspace directory — 所有 plugin 创建的 session 都在这个
 * 目录下,跟 user 主窗口的项目隔离。GUI sidebar 不会显示(因为 archive),
 * 也不污染 user 实际项目环境。
 */
const FEISHU_WORKSPACE = join(homedir(), ".opencode", "feishu-workspace")

const FEISHU_OPEN_API_DOMAIN: Record<"feishu" | "lark", string> = {
  feishu: "https://open.feishu.cn",
  lark: "https://open.larksuite.com",
}

/**
 * 飞书 session 专属 system prompt — 跟 build agent 自带的 system 拼接(opencode 行为)。
 *
 * 用途:禁用 LLM 的"反问 user"工具(`question` / `ask-user-question` 等),避免 agent
 * loop 调这类工具后**永远卡死等不到回答**(飞书无 GUI 接收 question 的 form 输入)。
 *
 * 真互动(form 卡片 + synthetic message)是 OpenClaw 对齐 roadmap 的 #5,Large 后续做。
 * 本 system prompt 是临时止血,2026-05-10 立。
 */
const FEISHU_SESSION_SYSTEM_PROMPT_BASE = [
  "本会话通过飞书 / Lark 桥接,你跟用户之间没有 GUI 交互层。",
  "**禁止**调用任何反问用户类工具(question / ask-user-question / askUser / clarify 等),",
  "因为用户在飞书 IM 看不到这些问题,会导致 agent loop 永远卡住。",
  "",
  "遇到信息不足或语义模糊时,请**直接做以下任一**:",
  "1. 基于现有信息和你的最佳判断给出答案;",
  "2. 在回复里明确写「需要补充以下信息:...」请用户重发新消息;",
  "3. 短答 + 列出可选方向让用户挑(纯文本即可,不要用工具)。",
  "",
  "其他工具(file 操作 / shell / bash / read 等)不受此限制,正常使用。",
].join("\n")

/**
 * [feat: feishu-bridge-light] ATTACH marker 协议 — 教 LLM 怎么把本地文件发回飞书。
 * 始终启用(无 opt-in 配置 — 路径白名单 + size 限制已足够安全)。
 */
const ATTACH_MARKER_PROMPT = [
  "## 文件回传协议",
  "需要把本地图片/文档发给用户时,在回复里嵌入 marker:",
  "  `[ATTACH:/abs/path/to/file.ext]`",
  "系统会自动上传到飞书并 strip 掉这个 marker(用户看不到 marker,只看到文件)。",
  "",
  "约束:",
  "- 路径必须是绝对路径,且在 `~/.opencode/feishu-workspace/` 子树内(写文件请用这个目录)",
  "- 图片(jpg/png/gif/webp/bmp/tiff/ico)≤ 10MB",
  "- 文件(pdf/doc/xls/ppt/mp4/opus)≤ 30MB,其它扩展名(docx/xlsx/txt/md/zip 等)走 stream 兜底",
  "- 一次回复可嵌多个 marker,系统按出现顺序处理",
].join("\n")

/**
 * [feat: feishu-bridge-light] CREATE_GROUP marker 协议 — 教 LLM 怎么触发自动建群。
 * 仅在 account.enableAutoGroupCreate=true 时拼入 system prompt(opt-in)。
 * 默认关闭防 prompt injection — 即便启用,真触发还需 user 二次确认。
 */
const CREATE_GROUP_MARKER_PROMPT = [
  "## 自动建群协议",
  "当用户明确表达想创建新群(例如'拉个群讨论 X' / '建一个 Y 群')时,在回复里嵌入 marker:",
  "  `[CREATE_GROUP:群名]`",
  "系统会发飞书确认卡片让用户点【✅ 确认】或【❌ 拒绝】,确认后才真创建群并把用户拉进群。",
  "",
  "约束:",
  "- 仅适用于私聊场景(系统会自动拒绝群里再次建群的请求)",
  "- 群名直接写中文,系统会按字面值建群",
  "- marker 不在用户可见的回复里(系统自动 strip)",
  "- 同一回复嵌多个 marker → 系统发多张确认卡片",
].join("\n")

/**
 * [feat: feishu-create-group-toggle-gui] 2026-05-24
 * `enableAutoGroupCreate=false` 时拼入的"禁止建群"指令 — soft constraint。
 *
 * 起因:仅"不教 marker"不足以阻止 LLM — agent 仍会尝试翻源码 / 调 SDK / 装 MCP 等
 * 替代路径帮用户达成建群目的(2026-05-24 实测撞 imbot read permission ask 卡)。
 *
 * 加这段后:LLM 收到明确禁令 + 引导 user 到 GUI 开关。即便 prompt injection 绕过,
 * imbot agent 受限的 tool 默认权限 + user 在飞书看到权限卡仍能拒绝,是第二道闸。
 */
const CREATE_GROUP_DISABLED_PROMPT = [
  "## 建群能力未启用",
  "此账号未启用「AI 自动创建新群」能力。当用户请求建群时(例如'帮我建群' / '拉个群' / 'create group' 等),请:",
  "1. 明确告知用户「此账号未启用自动建群,如需启用请在 DeskFox 设置 → 飞书桥接 → 选此账号点【编辑】→ 高级能力 → 勾选「允许 AI 自动创建新群」后重试」",
  "2. **不要**尝试通过其他途径建群 — 不要读源码 / 不要尝试调飞书 SDK / 不要装 MCP / 不要找替代方案",
  "3. **不要**让用户提供飞书 appId/appSecret/token 等凭证试图自己调用 API",
  "",
  "原因:建群是用户**主动授权**的能力(opt-in),关闭意味着用户明确选择「不允许」,你应当尊重此决定。",
].join("\n")

/**
 * 给飞书 user 的友好错误回复 — 把技术性 opencode error message 翻译成 user 可操作的指引。
 * 只识别 happy-path 阻塞性错误(没配 default model / provider key 无效),其他原样返回。
 *
 * 触发关键字来源(opencode source verified 2026-05-10):
 *   - "no providers found"  → packages/opencode/src/provider/provider.ts:1706
 *   - "no models found"     → packages/opencode/src/provider/provider.ts:1708
 *   - "Invalid model"       → CLI/github.ts;形态 `Invalid model ${x}. Model must be ...`
 *   - "API key"             → upstream provider SDK 抛 401 时常含 "API key" / "api key"
 *
 * exported for unit testing.
 */
export function friendlyErrorReply(err: Error): string {
  const msg = err.message ?? String(err)
  const lower = msg.toLowerCase()
  if (
    lower.includes("no providers found") ||
    lower.includes("no models found") ||
    lower.includes("no model configured") ||
    lower.includes("invalid model")
  ) {
    return (
      "❌ DeskFox 未配置默认 LLM model。\n" +
      "请打开 DeskFox 主程序 → Settings → Providers,给任一 provider 添加 API key,build agent 默认 model 会自动设置好。\n" +
      `(原始错误:${msg})`
    )
  }
  if (lower.includes("api key") || lower.includes("api_key") || lower.includes("401")) {
    return (
      "❌ DeskFox 调用 LLM 失败 — API key 可能无效或额度不足。\n" +
      "请到 DeskFox 主程序 → Settings → Providers 检查对应 provider 的 key。\n" +
      `(原始错误:${msg})`
    )
  }
  return `❌ DeskFox 处理出错:${msg}`
}

export interface PipelineOptions {
  account: FeishuAccount
  accountId: string
  /** opencode SDK v1 client(plugin PluginInput.client,in-process,自动 attach instance) */
  opencodeClient: OpencodeSDKClient
  /** event hook → waiter 路由器 */
  dispatcher: PromptDispatcher
  /** chatId → sessionID 持久化映射(plugin 重启后同 chat 仍能复用 session)*/
  chatSessionStore: ChatSessionStore
  /** 单次 prompt 超时(ms),默认 5min */
  promptTimeoutMs?: number
  /**
   * 可选注入的 lark Client(单测用 fake)。
   * 不传时按 account 配置内部创建,跟 PermissionCardController 注入风格对齐。
   * [feat: feishu-bridge-light]
   */
  larkClient?: Client
  /**
   * 可选 ATTACH 路径白名单根 — 默认 ~/.opencode/feishu-workspace(FEISHU_WORKSPACE)。
   * 单测用 temp 目录覆盖,避免污染真实 workspace。
   * [feat: feishu-bridge-light]
   */
  attachWorkspaceRoot?: string
}

export class MessagePipeline {
  private readonly opts: PipelineOptions
  private readonly larkClient: Client
  /** chatId → opencode sessionID(in-memory cache,真持久化在 chatSessionStore)*/
  private readonly chatToSession = new Map<string, string>()
  /** sessionID → chatId 反查(用于 permission.asked 事件路由)*/
  private readonly sessionToChat = new Map<string, string>()
  /** 飞书 CardKit 权限卡片控制器(LLM 调工具触发权限时弹卡片让 user 在飞书选)*/
  readonly permissionController: PermissionCardController
  /** [feat: feishu-bridge-light] yes/no 确认卡片控制器(自动建群二次确认等)*/
  readonly confirmController: ConfirmCardController
  /** [feat: feishu-bridge-light] 单调递增 confirm requestID 计数,跟 messageId 拼成唯一 key */
  private confirmCounter = 0

  constructor(opts: PipelineOptions) {
    this.opts = opts
    if (opts.larkClient) {
      this.larkClient = opts.larkClient
    } else {
      const appSecret = readSecret(opts.account.appSecret)
      this.larkClient = new Client({
        appId: opts.account.appId,
        appSecret,
        domain: FEISHU_OPEN_API_DOMAIN[opts.account.domain],
      })
    }
    this.permissionController = new PermissionCardController({
      opencodeClient: opts.opencodeClient,
      larkClient: this.larkClient,
      workspaceDir: FEISHU_WORKSPACE,
    })
    this.confirmController = new ConfirmCardController({
      larkClient: this.larkClient,
    })
  }

  /**
   * [feat: feishu-bridge-light] 动态拼接 system prompt:
   * - base(总是)
   * - ATTACH marker(总是 — 路径白名单 + size 限制安全)
   * - CREATE_GROUP marker(`account.enableAutoGroupCreate=true` 时)
   * - CREATE_GROUP DISABLED(`enableAutoGroupCreate=false` 时,soft constraint)
   *   [feat: feishu-create-group-toggle-gui] 2026-05-24 加 — 仅"不教 marker"
   *   不足以阻止 LLM 找替代路径建群,加明确禁令 + GUI 引导。
   */
  private getSystemPrompt(): string {
    const parts = [FEISHU_SESSION_SYSTEM_PROMPT_BASE, ATTACH_MARKER_PROMPT]
    if (this.opts.account.enableAutoGroupCreate) {
      parts.push(CREATE_GROUP_MARKER_PROMPT)
    } else {
      parts.push(CREATE_GROUP_DISABLED_PROMPT)
    }
    return parts.join("\n\n")
  }

  /**
   * 给 plugin 用 — 判断本 pipeline 是否拥有此 sessionID(用于 permission.asked 事件路由)。
   * 仅复用 *本 sidecar lifecycle 内* 创建的 session(in-memory cache),跟 chatToSession 同步。
   */
  hasSession(sessionID: string): boolean {
    return this.sessionToChat.has(sessionID)
  }

  /**
   * 收到 permission.asked event → 渲染卡片发到对应 chat。
   * sessionID 不属于本 pipeline 时静默 noop(plugin 应已通过 hasSession 路由,这里再防御一次)。
   */
  async handlePermissionAsked(request: PermissionRequest): Promise<void> {
    const chatId = this.sessionToChat.get(request.sessionID)
    if (!chatId) {
      console.warn(
        `[pipeline ${this.opts.accountId}] permission.asked for unknown sessionID ${request.sessionID}`,
      )
      return
    }
    await this.permissionController.start(request, chatId)
  }

  /**
   * [feat: feishu-bridge-light] 收到 confirm 卡片(yes/no)→ 路由到 ConfirmCardController。
   * plugin.ts 在 onCardAction 里先尝试 parseCardAction(permission),再 parseConfirmAction(confirm)。
   */
  async handleConfirmCardReply(parsed: ParsedConfirmAction): Promise<void> {
    await this.confirmController.handleReply(parsed)
  }

  /**
   * 收到 card.action.trigger event(WSS)→ 解析 + 路由到 controller.handleReply。
   * 不属于本 pipeline 的 card action(其他卡片 / 其他 account)静默 noop。
   */
  async handleCardActionReply(parsed: ParsedCardAction): Promise<void> {
    await this.permissionController.handleReply(parsed)
  }

  async handle(event: ImMessageEvent): Promise<void> {
    if (event.messageType !== "text") {
      console.log(
        `[pipeline ${this.opts.accountId}] skip non-text message: type=${event.messageType}`,
      )
      return
    }

    let text: string
    try {
      const parsed = JSON.parse(event.content) as { text?: string }
      text = (parsed.text ?? "").trim()
    } catch {
      console.warn(`[pipeline ${this.opts.accountId}] invalid content json:`, event.content)
      return
    }
    if (!text) return

    // [feat: feishu-bridge-light] /new slash command — 私聊清当前 session 切话题
    // 群聊禁用(chatId 共享会影响全员);先 strip mention 再判,允许 "@bot /new" 形态
    const cleaned = stripMentions(text, event.mentions)
    if (cleaned === "/new") {
      if (event.chatType !== "p2p") {
        await this.sendFeishuText(event.chatId, "⚠️ /new 仅支持私聊(群里清会影响全员)")
        return
      }
      const sessionID = this.chatToSession.get(event.chatId)
      this.opts.chatSessionStore.delete(this.opts.accountId, event.chatId)
      this.chatToSession.delete(event.chatId)
      if (sessionID) this.sessionToChat.delete(sessionID)
      await this.sendFeishuText(event.chatId, "✅ 已开启新对话")
      console.log(
        `[pipeline ${this.opts.accountId}] /new cleared session for chat=${event.chatId} (sessionID=${sessionID ?? "none"})`,
      )
      return
    }

    // [feat: feishu-create-group-hard-block] 2026-05-24
    // 建群意图 provider-agnostic 处理(p2p only,群聊跳过避免误拦"群是怎么建的"
    // 学术问题)。两条路径根据 flag 分流,都不依赖 LLM 处理"建群"transactional 操作:
    //
    // 1. flag=false(disabled)→ hard-block:不调 LLM,直接发 GUI 引导
    // 2. flag=true(enabled)→ direct-dispatch:提取群名 + 直发 confirm card(bypass LLM)
    //
    // 起因:claude-code 等 spawn-based provider 跳过 role=system 消息,导致 system
    // prompt 软约束失效 + marker 协议教学也失效(LLM 不知道 [CREATE_GROUP:] 协议)。
    // 此 pipeline 早退分支保证任何 provider 都行为一致。
    if (event.chatType === "p2p" && isGroupCreationIntent(cleaned)) {
      const enabled = this.opts.account.enableAutoGroupCreate
      if (!enabled) {
        console.log(
          `[pipeline ${this.opts.accountId}] hard-block CREATE_GROUP intent ` +
            `(text="${cleaned.slice(0, 50)}", flag=false, p2p) — skip LLM, send GUI guidance`,
        )
        await this.sendFeishuText(
          event.chatId,
          "此账号未启用自动建群能力。如需启用请在 DeskFox 设置 → 飞书桥接 → 选此账号点【编辑】→ 高级能力 → 勾选「允许 AI 自动创建新群」后重试。",
        )
        return
      }
      // flag=true 直发 confirm card(bypass LLM)
      const name = extractGroupName(cleaned)
      if (name) {
        console.log(
          `[pipeline ${this.opts.accountId}] direct-dispatch CREATE_GROUP name="${name}" — skip LLM, send confirm card`,
        )
        const requestID = `cg_${event.messageId}_${++this.confirmCounter}`
        const spec = {
          title: `🆕 创建群【${name}】?`,
          body: `你请求创建群 **${name}** 并把你拉进群。点【✅ 确认】才会建,【❌ 拒绝】不动。`,
        }
        // fire-and-forget:卡片发送 + user 后续点击都是 async
        void this.confirmController
          .start(requestID, event.chatId, spec, async (confirmed) => {
            if (!confirmed) {
              console.log(
                `[pipeline ${this.opts.accountId}] user rejected direct-dispatch group create '${name}'`,
              )
              return
            }
            await this.executeGroupCreate(name, event.chatId, event.senderOpenId)
          })
          .catch((err) => {
            console.error(
              `[pipeline ${this.opts.accountId}] direct-dispatch confirmController.start error:`,
              err,
            )
          })
        return
      }
      // 提取群名失败 → 友好提示 user,不调 LLM(provider-agnostic UX)
      console.log(
        `[pipeline ${this.opts.accountId}] direct-dispatch intent without name — prompting user`,
      )
      await this.sendFeishuText(
        event.chatId,
        [
          "好的,要建群。请在一条消息里告诉我群名,例如:",
          "• 帮我建群叫 **项目讨论**",
          "• 建群,群名是 **项目讨论**",
          "• 帮我建群,名字叫 **项目讨论**",
          "• 建群 **项目讨论**(动词后空格 + 群名)",
          "• create group called **project-talk**",
        ].join("\n"),
      )
      return
    }

    // [feat: feishu-group-mention-policy] 2026-05-24
    // 群消息 + requireMention=true(默认)+ bot 没被 @ → 早退,不调 LLM
    //
    // 前置条件:requireMention=false 实际生效需要 user 先在飞书开放平台改订阅
    // 模式为"全量群消息";否则飞书 server 不推非 @ 消息,本检查根本不会执行。
    //
    // 设计:p2p 私聊一律响应 / 群聊但 bot 被 @ 响应 / 群聊且 requireMention=false 响应。
    // 防御性 isBotMentioned 在 botOpenId 缺失时返 false,保守拒响应。
    if (
      event.chatType !== "p2p" &&
      this.opts.account.requireMention &&
      !isBotMentioned(event.mentions, this.opts.account.openId)
    ) {
      console.log(
        `[pipeline ${this.opts.accountId}] group msg without bot @ ` +
          `(chat=${event.chatId.slice(-8)}, requireMention=true) — skip LLM`,
      )
      return
    }

    console.log(
      `[pipeline ${this.opts.accountId}] msg from chat=${event.chatId}: "${text.slice(0, 100)}"`,
    )

    // 立即给 user 消息加 reaction(表情回复),让 user 知道"消息已收到正在响应"
    // best-effort fire-and-forget,失败不阻断主流程
    void this.ackMessage(event.messageId).catch((err) =>
      console.warn(
        `[pipeline ${this.opts.accountId}] ack reaction failed:`,
        (err as Error).message,
      ),
    )

    // 仅复用 *本 sidecar lifecycle 内* 创建的 session(in-memory cache)。
    // 历史 session(sidecar 上次启动前创建的)因 opencode 内部 InstanceState 不预 load
    // 而对 GET /session/{id}/message 路由返 401,导致拉不到 reply。
    // 短期 trade-off:sidecar 重启后所有 chat 第一条消息开新 session(无跨重启 multi-turn memory),
    // 但同 sidecar lifetime 内 chat 仍 multi-turn 复用 session。
    // FUTURE:让旧 session 也能拉(可能改走 /api/session/{id}/message 或 reload state)
    let sessionID = this.chatToSession.get(event.chatId)
    if (!sessionID) {
      try {
        const res = await this.opts.opencodeClient.session.create({
          query: { directory: FEISHU_WORKSPACE },
          body: {
            title: `Feishu ${event.chatType}/${event.chatId.slice(-8)}`,
          },
        })
        const id = (res as { data?: { id?: string } }).data?.id
        if (!id) throw new Error("session.create returned no id")
        sessionID = id
        this.chatToSession.set(event.chatId, sessionID)
        this.sessionToChat.set(sessionID, event.chatId)
        // 落盘:plugin 重启后同 chat 仍能复用此 session
        this.opts.chatSessionStore.set(this.opts.accountId, event.chatId, sessionID)
        // 🚨 立即 archive 飞书 plugin 创建的 session,user GUI sidebar 不显示
        await this.archiveSession(sessionID).catch((archErr) => {
          console.warn(
            `[pipeline ${this.opts.accountId}] archive session ${sessionID} failed (会显示在 GUI):`,
            archErr,
          )
        })
        console.log(
          `[pipeline ${this.opts.accountId}] new opencode session ${sessionID} (archived,持久化) for chat=${event.chatId}`,
        )
      } catch (err) {
        console.error(`[pipeline ${this.opts.accountId}] createSession failed:`, err)
        await this.sendFeishuText(event.chatId, friendlyErrorReply(err as Error))
        return
      }
    }

    let reply: string
    try {
      reply = await this.runOpencode(sessionID, text, this.opts.account.agent)
    } catch (err) {
      console.error(`[pipeline ${this.opts.accountId}] opencode error:`, err)
      await this.sendFeishuText(event.chatId, friendlyErrorReply(err as Error))
      return
    }

    // [feat: feishu-bridge-light] reply 后处理:
    // 1. CREATE_GROUP marker(opt-in)→ 发 confirm 卡片让 user 确认(异步),strip marker
    // 2. ATTACH marker(总是)→ 上传文件(同步)、strip marker、失败 warning append
    const afterGroup = this.processGroupMarkers(reply, event)
    const finalText = await this.processAttachments(afterGroup, event.chatId)

    if (!finalText.trim()) {
      console.warn(`[pipeline ${this.opts.accountId}] empty reply for chat=${event.chatId}`)
      return
    }

    console.log(
      `[pipeline ${this.opts.accountId}] reply (len=${finalText.length}) preview: "${finalText.slice(0, 200)}"`,
    )
    try {
      await this.sendFeishuText(event.chatId, finalText)
      console.log(
        `[pipeline ${this.opts.accountId}] sent reply to chat=${event.chatId}: "${finalText.slice(0, 100)}"`,
      )
    } catch (err) {
      console.error(`[pipeline ${this.opts.accountId}] sendFeishuText failed:`, err)
    }
  }

  /**
   * [feat: feishu-bridge-light] 解析 reply 里的 [ATTACH:path] marker、上传文件、strip marker。
   *
   * 安全约束:路径必须在 ~/.opencode/feishu-workspace/ 子树内(classifyAttachment 判)。
   * 单个 ATTACH 失败不影响其它;失败原因追加到最终文本 warnings 段尾,user 可见。
   *
   * 返回最终要发到飞书的文本(可能为空 — 全是附件无文字时)。
   *
   * 非 private 以便单测直接驱动(等同 testHandle 模式)。
   */
  async processAttachments(reply: string, chatId: string): Promise<string> {
    const { paths, cleanText } = parseAttachMarkers(reply)
    if (paths.length === 0) return reply

    console.log(
      `[pipeline ${this.opts.accountId}] reply has ${paths.length} ATTACH marker(s): ${paths.join(", ")}`,
    )
    const warnings: string[] = []
    for (const p of paths) {
      const cls = classifyAttachment(p, this.opts.attachWorkspaceRoot)
      if (cls.kind === "reject") {
        warnings.push(`⚠️ 拒绝发送 \`${p}\`:${cls.reason}`)
        console.warn(
          `[pipeline ${this.opts.accountId}] ATTACH reject: ${p} (${cls.reason})`,
        )
        continue
      }
      try {
        if (cls.kind === "image") {
          const key = await uploadImage(this.larkClient, p)
          await sendImageMessage(this.larkClient, chatId, key)
          console.log(`[pipeline ${this.opts.accountId}] sent image ${p} → ${key}`)
        } else {
          const key = await uploadFile(this.larkClient, p, cls.fileType)
          await sendFileMessage(this.larkClient, chatId, key)
          console.log(`[pipeline ${this.opts.accountId}] sent file ${p} → ${key}`)
        }
      } catch (e) {
        const msg = (e as Error).message
        warnings.push(`⚠️ 发送 \`${p}\` 失败:${msg}`)
        console.warn(`[pipeline ${this.opts.accountId}] ATTACH upload failed ${p}: ${msg}`)
      }
    }
    return [cleanText, ...warnings].filter((s) => s.trim()).join("\n\n")
  }

  /**
   * [feat: feishu-bridge-light] 解析 reply 里 [CREATE_GROUP:name] marker。
   *
   * 触发条件(双门控):
   *   - account.enableAutoGroupCreate === true(opt-in 配置)
   *   - event.chatType === "p2p"(仅私聊,群里不准 AI 再建群)
   *
   * 触发时为每个 marker 发 confirm 卡片(异步,通过 ConfirmCardController);
   * user 点确认 → callback 触发 chat.create + getShareLink + sendFeishuText 结果消息。
   * 不论触发与否,marker 都从 reply 文本 strip 掉。
   *
   * 不阻塞 — 卡片发送和后续 user 点击都是 async,本方法立即返回 strip 后的文本。
   */
  processGroupMarkers(reply: string, event: ImMessageEvent): string {
    const { names, cleanText } = parseCreateGroupMarkers(reply)
    if (names.length === 0) return reply

    const enabled = this.opts.account.enableAutoGroupCreate
    const isP2P = event.chatType === "p2p"
    if (!enabled || !isP2P) {
      console.log(
        `[pipeline ${this.opts.accountId}] CREATE_GROUP markers (${names.length}) stripped but not triggered (enableAutoGroupCreate=${enabled}, chatType=${event.chatType})`,
      )
      return cleanText
    }

    for (const name of names) {
      const requestID = `cg_${event.messageId}_${++this.confirmCounter}`
      const spec = {
        title: `🆕 创建群【${name}】?`,
        body: `AI 想自动创建群 **${name}** 并把你拉进群。点【✅ 确认】才会建,【❌ 拒绝】不动。`,
      }
      // fire-and-forget:卡片发送 + user 后续点击都是 async
      void this.confirmController
        .start(requestID, event.chatId, spec, async (confirmed) => {
          if (!confirmed) {
            console.log(
              `[pipeline ${this.opts.accountId}] user rejected group create '${name}'`,
            )
            return
          }
          await this.executeGroupCreate(name, event.chatId, event.senderOpenId)
        })
        .catch((err) => {
          console.error(
            `[pipeline ${this.opts.accountId}] confirmController.start error:`,
            err,
          )
        })
    }
    return cleanText
  }

  /**
   * [feat: feishu-bridge-light] user 确认建群后实际执行 — chat.create + chat.link + 发结果消息。
   * 任一步失败都把原因发给 user(不抛,避免 confirmController callback 异常吞掉 user 反馈)。
   */
  private async executeGroupCreate(
    name: string,
    originalChatId: string,
    senderOpenId: string | undefined,
  ): Promise<void> {
    try {
      const { chatId, name: actualName } = await createGroup(
        this.larkClient,
        name,
        senderOpenId ? [senderOpenId] : [],
      )
      console.log(
        `[pipeline ${this.opts.accountId}] created group '${actualName}' chatId=${chatId} (拉 user=${senderOpenId ?? "none"})`,
      )
      const shareLink = await getShareLink(this.larkClient, chatId)
      const msg = shareLink
        ? `✅ 已创建群【${actualName}】\n加入链接(一周有效):${shareLink}`
        : `✅ 已创建群【${actualName}】\nchat_id: \`${chatId}\`(分享链接获取失败,可能是团队群限制或权限不足)`
      await this.sendFeishuText(originalChatId, msg)
    } catch (err) {
      const errMsg = (err as Error).message
      console.error(
        `[pipeline ${this.opts.accountId}] executeGroupCreate '${name}' failed:`,
        errMsg,
      )
      try {
        await this.sendFeishuText(
          originalChatId,
          `❌ 创建群【${name}】失败:${errMsg}`,
        )
      } catch (sendErr) {
        console.error(
          `[pipeline ${this.opts.accountId}] notify create-group failure also failed:`,
          sendErr,
        )
      }
    }
  }

  /**
   * 启动 prompt + 等 dispatcher 拿 reply。
   *
   * register waiter 必须在 promptAsync **之前**(防错过早期 events)。
   *
   * !! 已知 bug:dispatcher 累积所有 text part(包括 user prompt 的 part)→ reply echo user 输入。
   *    修需要按 message role 区分(part 没 role 字段,得通过 message.updated event 反查)。
   *    留 followup,先保证有 reply(echo)优于 empty reply。
   */
  private async runOpencode(sessionID: string, text: string, agent: string): Promise<string> {
    // 默认 30 分钟超时(2026-05-10 由 5min 提)。
    // 实测出现过 7m18s 才完成的回复(用户问"DeskFox 服务启动后..."触发 75 次工具调用)
    // 5min 超时强制走 dispatcher partial 路径 → runOpencode 又忽略 partial 改读
    // session.messages,此时 LLM 还在跑、message 仍空,plugin 返空字符串 → 飞书没回复。
    // 30min 覆盖典型 agent 长任务上限;真要跑超 30min 的复杂任务,需走 Layer 2 重构
    // (订阅 message.updated 事件 + time.completed 字段判完成,告别启发式超时)。
    const timeoutMs = this.opts.promptTimeoutMs ?? 30 * 60 * 1000

    const idlePromise = this.opts.dispatcher.register(sessionID, timeoutMs)

    const accountModel = this.opts.account.model
    void this.opts.opencodeClient.session
      .promptAsync({
        path: { id: sessionID },
        query: { directory: FEISHU_WORKSPACE },
        body: {
          agent,
          system: this.getSystemPrompt(),
          ...(accountModel
            ? { model: { providerID: accountModel.providerID, modelID: accountModel.modelID } }
            : {}),
          parts: [{ type: "text", text }],
        },
      })
      .catch((err) => {
        console.error(`[pipeline ${this.opts.accountId}] promptAsync error:`, err)
      })

    // 等 idle 信号(不依赖 dispatcher 累积 part — race condition 见 dispatcher 注释)
    await idlePromise

    // setImmediate 跳出当前 event hook 的 microtask scope,确保 server 端 message/part db 写完 + auth context 正常
    await new Promise<void>((resolve) => setImmediate(resolve))

    // 直接拉 messages 取 last assistant text(role 准确,不会 echo user prompt)
    const msgsRes = await this.opts.opencodeClient.session.messages({
      path: { id: sessionID },
      query: { directory: FEISHU_WORKSPACE },
    })
    const wrap = msgsRes as {
      data?: Array<{
        info: {
          id?: string
          role?: string
          parentID?: string
          error?: { message?: string; data?: { message?: string } }
        }
        parts: Array<{ type?: string; text?: string; synthetic?: boolean; ignored?: boolean }>
      }>
      error?: unknown
      response?: { status?: number }
    }
    if (!wrap.data) {
      console.warn(
        `[pipeline ${this.opts.accountId}] messages fetch failed status=${wrap.response?.status}, fallback ""`,
      )
      return ""
    }
    const data = wrap.data
    if (data.length === 0) return ""

    // 本轮 user msg id — 用来限定只取本轮 assistant(防 reject 时回退取前一轮答案)
    let userMsgId: string | undefined = undefined
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i]!.info.role === "user") {
        userMsgId = data[i]!.info.id
        break
      }
    }

    const assistantEntry = findLastUsefulAssistant(data, userMsgId)
    if (!assistantEntry) {
      console.warn(
        `[pipeline ${this.opts.accountId}] 本轮无 useful assistant(user msg=${userMsgId ?? "?"})— 可能 reject + LLM 无后续输出`,
      )
      return ""
    }

    // 检查 LLM 错误(opencode 把 LLM API error 存进 assistant message.error)
    const err = assistantEntry.info.error
    if (err) {
      const errMsg =
        (err as { data?: { message?: string } }).data?.message ?? err.message ?? "opencode LLM error"
      throw new Error(errMsg)
    }

    // 拼 text parts(skip step-start / step-finish / reasoning / tool 等;只取 type=text)
    const texts: string[] = []
    for (const p of assistantEntry.parts) {
      if (p.type === "text" && typeof p.text === "string" && !p.synthetic && !p.ignored) {
        texts.push(p.text)
      }
    }
    return texts.join("").trim()
  }

  /** 测试 / debug 入口:外部调用直接驱动 handle(传 ImMessageEvent 模拟飞书消息) */
  async testHandle(event: ImMessageEvent): Promise<void> {
    return this.handle(event)
  }

  /** 测试 / debug:直接调 SDK session.messages 并打 raw response 详情(不走 pipeline) */
  async debugFetchMessages(sessionID: string): Promise<unknown> {
    const r = await this.opts.opencodeClient.session.messages({
      path: { id: sessionID },
      query: { directory: FEISHU_WORKSPACE },
    })
    const wrap = r as {
      data?: unknown
      error?: unknown
      response?: { status?: number; statusText?: string; url?: string }
      request?: { url?: string; method?: string; headers?: { get?: (k: string) => string | null } }
    }
    const auth = wrap.request?.headers?.get?.("Authorization") ?? null
    return {
      hasData: !!wrap.data,
      dataLen: Array.isArray(wrap.data) ? wrap.data.length : "not-array",
      errorPreview: JSON.stringify(wrap.error)?.slice(0, 200),
      status: wrap.response?.status,
      statusText: wrap.response?.statusText,
      requestUrl: wrap.request?.url,
      requestMethod: wrap.request?.method,
      authHeader: auth ? `${auth.slice(0, 20)}...` : "(none)",
    }
  }

  /**
   * Archive 一个 opencode session(plugin 创建的 system session 用,GUI sidebar 默认不显)。
   *
   * 通过 v1 SDK 的 raw `_client.patch`(其 update 类型 schema stale 不含 time.archived,
   * 但 server 端实际接受 — 用 cast 绕过 type 限制)。
   */
  private async archiveSession(sessionID: string): Promise<void> {
    const rawClient = (this.opts.opencodeClient as unknown as { _client?: unknown })._client
    if (!rawClient || typeof (rawClient as { patch?: unknown }).patch !== "function") {
      throw new Error("opencode SDK client missing internal _client.patch")
    }
    await (rawClient as { patch: (req: unknown) => Promise<unknown> }).patch({
      url: "/session/{id}",
      path: { id: sessionID },
      query: { directory: FEISHU_WORKSPACE },
      body: {
        time: { archived: Date.now() },
      },
    })
  }

  /**
   * 给 user 的消息加 emoji reaction,告诉 user "消息收到、正在响应"。
   * 同 OpenClaw 飞书桥接默认 ack 行为(避免 LLM 慢响应时 user 不知 plugin 是不是死了)。
   * "OK" 是飞书内置 emoji_type 之一,显示成 ✅ 类似的勾选标记。
   */
  private async ackMessage(messageId: string): Promise<void> {
    await this.larkClient.im.v1.messageReaction.create({
      data: { reaction_type: { emoji_type: "OK" } },
      path: { message_id: messageId },
    })
  }

  private async sendFeishuText(chatId: string, text: string): Promise<void> {
    await this.larkClient.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    })
  }
}

// ============================================================
// findLastUsefulAssistant — 倒序找有内容的 assistant message
// ============================================================
//
// 背景:opencode agent loop 在某些回复(工具调用 / 多步)尾部会追加一条 0-token 空 step
// placeholder message,parts 形状固定为 step-start → text("") → step-finish,parentID 跟
// 它前面那条真 reply 的 parentID 一样,瞬时完成(time.completed === time.created)。
// 简单倒序找 last assistant 会取到这条 placeholder → 返回空字符串 → 飞书侧没回复。
//
// 修法:倒序时跳过空 placeholder(无 error 且无非空 text part),继续往前找真 reply。
// 短回复(无 placeholder 跟随)不受影响 — 倒序第一条就是真 reply 命中。
//
// 此函数纯函数,作为 Logic 清单覆盖到 100% 行(R5 关键模块清单 helper extract 模式)。

/** SDK session.messages 返回 entry 的子集类型(仅本 helper 需要的字段)*/
export type AssistantMessageEntry = {
  info: {
    id?: string
    role?: string
    parentID?: string
    error?: { message?: string; data?: { message?: string } }
  }
  parts: Array<{ type?: string; text?: string; synthetic?: boolean; ignored?: boolean }>
}

/**
 * 倒序找当前 turn 里最近一条"有用"的 assistant message。
 *
 * 有用 = 有 error(error 也是有效信号,caller 会抛出去)或 有非空 text part。
 * 跳过条件 = 0-token / 空文本 placeholder ghost(text 全空 + 无 error)。
 *
 * **本轮约束**:只考虑 `parentID === userMsgId` 的 assistant message。前一轮的 assistant
 * 不会被误取(2026-05-11 修;之前没此约束,reject 时本轮 assistant 无 text + 没 info.error
 * 被识别为 ghost 跳过 → 倒序回退到上一轮 assistant text → 把上一轮答案重发到飞书 →
 * user 看到"已拒绝"卡片但仍收到旧答案,严重安全感问题)。
 *
 * 返回 undefined → 本轮没有任何 useful assistant message,caller 应返空字符串。
 */
export function findLastUsefulAssistant(
  data: ReadonlyArray<AssistantMessageEntry>,
  userMsgId?: string,
): AssistantMessageEntry | undefined {
  for (let i = data.length - 1; i >= 0; i--) {
    const m = data[i]
    if (!m || m.info.role !== "assistant") continue
    // 本轮约束:assistant.parentID 必须等于 userMsgId(本轮触发的 user msg)
    // 没传 userMsgId 时退化成"任何轮"行为,兼容旧 caller(测试 / 回归保留)
    if (userMsgId !== undefined && m.info.parentID !== userMsgId) continue

    if (m.info.error) return m

    const hasRealText = m.parts.some(
      (p) =>
        p.type === "text" &&
        typeof p.text === "string" &&
        p.text.trim() !== "" &&
        !p.synthetic &&
        !p.ignored,
    )
    if (hasRealText) return m
    // 否则:placeholder ghost,继续往前扫(仍受 parentID 约束)
  }
  return undefined
}
