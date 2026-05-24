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
  GROUP_NAME_MAX_LEN,
  isBotMentioned,
  isGroupCreationIntent,
  parseAttachMarkers,
  parseGroupCommand,
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
 * [feat: feishu-group-slash-command] 2026-05-24
 * 建群引导 — 教 LLM 用户表达建群意图时回复"请用 /group <群名>",不再 emit marker。
 *
 * 替换了 v1 的 CREATE_GROUP_MARKER_PROMPT([CREATE_GROUP:name] 协议)和 v2 的
 * CREATE_GROUP_DISABLED_PROMPT(flag=false 时禁令)。
 *
 * 设计:flag 状态不再影响 system prompt — 任何 flag 状态下 LLM 都引导用户用 /group。
 * /group 路径本身在 pipeline.handle() 层处理(0 LLM 调用),flag=false 时 user 用
 * /group 仍能建群(slash command 显式触发,绕过 flag);flag=true 时让 LLM 自动建群的
 * 老能力被砍掉(LLM marker 路径已删,这是 user 拍板的 tradeoff:0 LLM 漂移)。
 *
 * **provider-agnostic 兜底**:跳过 system prompt 的 provider(claude-code 等)看不到这段,
 * 但 pipeline 入口层的 isGroupCreationIntent 白名单会拦住自然语言建群请求并 reply 引导,
 * user 仍能学会用 /group。
 */
const GROUP_CREATION_GUIDE_PROMPT = [
  "## 建群引导",
  "如果用户表达建群意图(例如'帮我建群' / '把刚才内容拉个群继续' / 'create a group for X'),",
  "**不要尝试自己建群**,请回复用户使用斜杠命令:",
  "",
  "  `/group <群名>`",
  "",
  "例:`/group 项目讨论`。让用户自己决定是否触发建群。",
  "",
  "**不要**尝试通过其他途径建群 — 不要读源码 / 不要调飞书 SDK / 不要装 MCP / 不要找替代方案,",
  "**不要**让用户提供飞书 appId/appSecret/token 等凭证。",
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
   * 动态拼接 system prompt:
   * - base(总是)
   * - ATTACH marker(总是 — 路径白名单 + size 限制安全)
   * - 建群引导(总是 — 教 LLM 引导用户用 /group,不再 emit marker)
   *   [feat: feishu-group-slash-command] 2026-05-24
   */
  private getSystemPrompt(): string {
    return [
      FEISHU_SESSION_SYSTEM_PROMPT_BASE,
      ATTACH_MARKER_PROMPT,
      GROUP_CREATION_GUIDE_PROMPT,
    ].join("\n\n")
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

    // [feat: feishu-group-slash-command] 2026-05-24
    // /group <群名> — 显式建群命令(主路径,0 LLM 调用)
    //
    // 群聊禁用:跟 /new 一致策略,群里建子群 UX 不清晰。
    // 私聊命中:解析成功 → 弹 confirm card → user 点 ✅ → executeGroupCreate
    //         解析失败(无参数 / 超长) → reply 提示
    //
    // 设计:绕开 LLM provider,所有 provider(default / claude-code / imbot)行为一致。
    const groupCmd = parseGroupCommand(cleaned)
    if (groupCmd.matched) {
      if (event.chatType !== "p2p") {
        await this.sendFeishuText(
          event.chatId,
          "⚠️ /group 仅支持私聊(群里建子群 UX 不清晰,请在私聊里执行)",
        )
        return
      }
      if (groupCmd.error === "no_name") {
        await this.sendFeishuText(
          event.chatId,
          "⚠️ 用法:`/group <群名>`,例:`/group 项目讨论`",
        )
        return
      }
      if (groupCmd.error === "too_long") {
        await this.sendFeishuText(
          event.chatId,
          `⚠️ 群名超长(最多 ${GROUP_NAME_MAX_LEN} 字符,飞书限制),请缩短后重试`,
        )
        return
      }
      const name = groupCmd.groupName!
      console.log(
        `[pipeline ${this.opts.accountId}] /group dispatch name="${name}" — skip LLM, send confirm card`,
      )
      const requestID = `cg_${event.messageId}_${++this.confirmCounter}`
      const spec = {
        title: `🆕 创建群【${name}】?`,
        body: `你请求创建群 **${name}** 并把你拉进群。点【✅ 确认】才会建,【❌ 拒绝】不动。`,
      }
      void this.confirmController
        .start(requestID, event.chatId, spec, async (confirmed) => {
          if (!confirmed) {
            console.log(
              `[pipeline ${this.opts.accountId}] user rejected /group create '${name}'`,
            )
            return
          }
          await this.executeGroupCreate(name, event.chatId, event.senderOpenId)
        })
        .catch((err) => {
          console.error(
            `[pipeline ${this.opts.accountId}] /group confirmController.start error:`,
            err,
          )
        })
      return
    }

    // [feat: feishu-group-slash-command] 2026-05-24
    // 自然语言建群意图回退引导 — 白名单短语命中 → 不走 LLM,reply 引导用 /group
    //
    // 设计:provider-agnostic 兜底防 imbot wall(claude-code 等跳过 system prompt 的
    // provider 看不到 GROUP_CREATION_GUIDE_PROMPT,这里直接拦)。p2p only 跟 /new 一致。
    // flag 不再影响行为(flag 关时 user 仍可以 /group,不需要"启用"操作 — slash command
    // 显式触发是 user 主动授权,不需要预先 opt-in)。
    if (event.chatType === "p2p" && isGroupCreationIntent(cleaned)) {
      console.log(
        `[pipeline ${this.opts.accountId}] natural-language group intent detected ` +
          `(text="${cleaned.slice(0, 50)}") — guide user to /group`,
      )
      await this.sendFeishuText(
        event.chatId,
        [
          "你想创建群?请使用斜杠命令:",
          "",
          "  `/group <群名>`",
          "",
          "例:",
          "  • `/group 项目讨论`",
          "  • `/group 产品需求-2026Q2`",
          "",
          "(创建后我会拉你进群,后续讨论在那里继续)",
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
      !isBotMentioned(event.mentions, this.opts.account.botName ?? "")
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
      // [feat: feishu-llm-strip-mention-placeholders] 2026-05-24
      // 传 cleaned(已 strip @_user_N 飞书占位符)而非 raw text,避免 LLM 误把
      // 占位符当成另一个联系人(实测 bot reply 含"我不是 @_user_1..."类幻觉)。
      reply = await this.runOpencode(sessionID, cleaned, this.opts.account.agent)
    } catch (err) {
      console.error(`[pipeline ${this.opts.accountId}] opencode error:`, err)
      await this.sendFeishuText(event.chatId, friendlyErrorReply(err as Error))
      return
    }

    // reply 后处理:ATTACH marker(总是)→ 上传文件(同步)、strip marker、失败 warning append。
    // [CREATE_GROUP:name] marker 路径已删([feat: feishu-group-slash-command] 2026-05-24),
    // 建群只走用户显式 /group slash command。
    const finalText = await this.processAttachments(reply, event.chatId)

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
