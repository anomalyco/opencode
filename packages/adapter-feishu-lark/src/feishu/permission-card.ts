// [fork-only] PermissionCard — 飞书 CardKit 渲染 opencode permission 请求 + 响应路由
// [feat: feishu-bridge-permission-card] 2026-05-10
//
// 触发:plugin event hook 收到 `permission.asked` event(opencode permission.ask 时 fire)。
// 流程:
//   1. plugin 调 PermissionCardController.start(request, chatId)
//   2. 渲染 InteractiveCard JSON,调 lark im.v1.message.create 发到 chatId
//   3. 记 Map<requestID, {chatId, cardMessageId, timeoutHandle, sessionID}>
//   4. WSS 收到 card.action.trigger event → wss-client 调 controller.handleReply
//   5. handleReply 调 client.permission.reply({requestID, reply}) → opencode unblocks agent
//   6. 5min 超时无响应 → 自动 reply "reject" 解锁
//
// 类比 OpenClaw `tools/ask-user-question.js`,但走 opencode 标准 SDK + Bus event 而非内嵌 runtime。

import type { Client } from "@larksuiteoapi/node-sdk"
import type { OpencodeSDKClient } from "./message-pipeline"

/** 默认 5 分钟超时 — 防 user 关掉飞书后 chatQueue 永久卡死 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/** opencode permission.asked event payload(从 packages/opencode/src/permission/index.ts:Request 提子集)*/
export interface PermissionRequest {
  id: string // PermissionID
  sessionID: string
  permission: string // "edit" | "external_directory" | "read" | "glob" | ... 等 10 类
  patterns: ReadonlyArray<string>
  metadata: Record<string, unknown>
  always: ReadonlyArray<string>
  tool?: { messageID: string; callID: string }
}

/** opencode permission.reply 入参(对齐 SDK schema) */
export type PermissionReply = "once" | "always" | "reject"

/** 飞书 CardKit InteractiveCard 子集(只用到的字段) */
export interface InteractiveCard {
  config?: { update_multi?: boolean; wide_screen_mode?: boolean }
  header?: {
    title: { tag: "plain_text"; content: string }
    template?: string
  }
  elements: Array<unknown>
}

/** action.value 的 schema — encode permission_reply 信息 */
interface PermissionCardActionValue {
  kind: "permission_reply"
  requestID: string
  reply: PermissionReply
}

/** 飞书 card.action.trigger event 解析后的子集 */
export interface ParsedCardAction {
  requestID: string
  reply: PermissionReply
  cardMessageId?: string
  openId?: string
}

/** 不同 permission 类型的 emoji + 中文名展示(纯展示,未列的 fallback)*/
const PERMISSION_DISPLAY: Record<string, { emoji: string; label: string }> = {
  edit: { emoji: "✏️", label: "修改文件" },
  external_directory: { emoji: "📁", label: "访问项目目录之外的文件" },
  read: { emoji: "📖", label: "读取文件" },
  glob: { emoji: "🔍", label: "扫描文件" },
  grep: { emoji: "🔎", label: "搜索文件内容" },
  lsp: { emoji: "🧠", label: "调用语言服务" },
  skill: { emoji: "🎯", label: "执行 Skill" },
  todowrite: { emoji: "📝", label: "更新待办列表" },
  webfetch: { emoji: "🌐", label: "网络抓取" },
  websearch: { emoji: "🔭", label: "搜索网络" },
}

function displayFor(permission: string): { emoji: string; label: string } {
  return PERMISSION_DISPLAY[permission] ?? { emoji: "🔐", label: permission }
}

/** 截断字符串(防 lark 卡片元素超长)*/
function truncate(s: string, max = 200): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + "…"
}

/**
 * 把 PermissionRequest 转 飞书 InteractiveCard JSON。纯函数,易测。
 *
 * 卡片结构:
 *   header(template=orange):🔐 标题  显示权限类型
 *   div block:patterns 列表(单个 markdown 元素,最多 5 个 pattern 各占 1 行,余 ...N 项)
 *   div block:metadata 摘要(filepath / parentDir / 等)
 *   note:小字 — 提示 user 这是 AI 触发的请求
 *   action:3 button(允许一次 / 始终允许 / 拒绝)
 */
export function buildPermissionCard(request: PermissionRequest): InteractiveCard {
  const { emoji, label } = displayFor(request.permission)

  const headerTitle = `${emoji} 需要权限:${label}`

  // patterns 列表 — 最多展示 5 个
  const shownPatterns = request.patterns.slice(0, 5)
  const restCount = request.patterns.length - shownPatterns.length
  const patternsLines = shownPatterns.map((p) => `\`${truncate(p, 150)}\``).join("\n")
  const patternsBlock =
    patternsLines + (restCount > 0 ? `\n…还有 ${restCount} 项` : "")

  // metadata 摘要(常见字段:filepath / parentDir / url / command 等)
  const metaLines: string[] = []
  for (const [k, v] of Object.entries(request.metadata)) {
    if (typeof v === "string") {
      metaLines.push(`**${k}**:\`${truncate(v, 200)}\``)
    } else if (typeof v === "number" || typeof v === "boolean") {
      metaLines.push(`**${k}**:${v}`)
    }
    // skip non-primitive metadata
  }
  const metaBlock = metaLines.length > 0 ? metaLines.join("\n") : "_(无附加信息)_"

  const elements: Array<unknown> = [
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: patternsBlock || "_(无路径)_",
      },
    },
  ]

  if (metaLines.length > 0) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: metaBlock,
      },
    })
  }

  elements.push(
    {
      tag: "note",
      elements: [
        {
          tag: "plain_text",
          content: "AI 助手请求执行上述操作,请审核后选择",
        },
      ],
    },
    {
      tag: "action",
      actions: [
        {
          tag: "button",
          text: { tag: "plain_text", content: "✅ 允许一次" },
          type: "primary",
          value: makeActionValue(request.id, "once"),
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: "🟢 始终允许" },
          type: "default",
          value: makeActionValue(request.id, "always"),
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: "🛑 拒绝" },
          type: "danger",
          value: makeActionValue(request.id, "reject"),
        },
      ],
    },
  )

  return {
    config: { update_multi: true, wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: headerTitle },
      template: "orange",
    },
    elements,
  }
}

function makeActionValue(requestID: string, reply: PermissionReply): PermissionCardActionValue {
  return { kind: "permission_reply", requestID, reply }
}

/**
 * 解析飞书 card.action.trigger 事件,提取 PermissionReply 信息。
 *
 * 返 null 表示不是我们的 permission 卡片(可能是其他卡片或异常 payload)— 上游应忽略。
 *
 * 飞书 event payload 结构(InteractiveCardActionEvent):
 *   {
 *     open_id, user_id?, tenant_key, open_message_id, token,
 *     action: { value: <我们 makeActionValue 写入的对象>, tag, ... }
 *   }
 */
export function parseCardAction(event: unknown): ParsedCardAction | null {
  if (!event || typeof event !== "object") return null
  const e = event as Record<string, unknown>
  const action = e.action as Record<string, unknown> | undefined
  if (!action || typeof action !== "object") return null
  const value = action.value
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  if (v.kind !== "permission_reply") return null
  const requestID = v.requestID
  const reply = v.reply
  if (typeof requestID !== "string") return null
  if (reply !== "once" && reply !== "always" && reply !== "reject") return null
  const cardMessageId = typeof e.open_message_id === "string" ? e.open_message_id : undefined
  const openId = typeof e.open_id === "string" ? e.open_id : undefined
  return { requestID, reply, cardMessageId, openId }
}

interface PendingCard {
  chatId: string
  sessionID: string
  cardMessageId?: string
  timeoutHandle: ReturnType<typeof setTimeout>
}

export interface PermissionCardOptions {
  /** opencode SDK client(in-process plugin client)*/
  opencodeClient: OpencodeSDKClient
  /** lark client 用来发卡片 */
  larkClient: Client
  /** 飞书 plugin workspace(directory query 参数) */
  workspaceDir: string
  /** 超时 ms,默认 5 分钟 */
  timeoutMs?: number
}

/**
 * 管理一组 pending 权限卡片的生命周期。
 *
 * 一个 instance 即可服务整个 plugin(多 chat 共享),按 requestID key 去重。
 * 同一 sessionID 多个 permission 序列到达 → 各自一张卡片,user 各自决定。
 */
export class PermissionCardController {
  private readonly pending = new Map<string, PendingCard>()
  private readonly opts: PermissionCardOptions

  constructor(opts: PermissionCardOptions) {
    this.opts = opts
  }

  /**
   * 收到 permission.asked → 渲染卡片 → send to chatId → start timeout countdown。
   *
   * 调用方需自行做 sessionID → chatId 反查。
   */
  async start(request: PermissionRequest, chatId: string): Promise<void> {
    if (this.pending.has(request.id)) {
      console.warn(`[permission-card] duplicate start for ${request.id}, skipping`)
      return
    }

    const card = buildPermissionCard(request)

    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const timeoutHandle = setTimeout(() => {
      void this.handleTimeout(request.id)
    }, timeoutMs)

    this.pending.set(request.id, {
      chatId,
      sessionID: request.sessionID,
      cardMessageId: undefined,
      timeoutHandle,
    })

    try {
      const res = await this.opts.larkClient.im.v1.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: chatId,
          msg_type: "interactive",
          content: JSON.stringify(card),
        },
      })
      const cardMessageId = (res as { data?: { message_id?: string } }).data?.message_id
      if (cardMessageId) {
        const entry = this.pending.get(request.id)
        if (entry) entry.cardMessageId = cardMessageId
      }
      console.log(
        `[permission-card] sent card for request ${request.id} (${request.permission}) to chat ${chatId}`,
      )
    } catch (err) {
      console.error(`[permission-card] sendCard failed for ${request.id}:`, err)
      // 发送失败 → 直接 reject 解锁 agent,避免卡死
      this.cleanup(request.id)
      await this.replyToOpencode(request.id, request.sessionID, "reject")
    }
  }

  /**
   * 收到 card.action.trigger → user 点了一个按钮。
   *
   * 路由:取 requestID 对应 pending → 调 opencode reply → 清理。
   */
  async handleReply(parsed: ParsedCardAction): Promise<void> {
    const entry = this.pending.get(parsed.requestID)
    if (!entry) {
      console.warn(`[permission-card] no pending for ${parsed.requestID} (already replied or expired)`)
      return
    }
    this.cleanup(parsed.requestID)
    console.log(
      `[permission-card] user replied ${parsed.reply} for ${parsed.requestID} (chat=${entry.chatId})`,
    )
    await this.replyToOpencode(parsed.requestID, entry.sessionID, parsed.reply)
  }

  /** 5min 超时兜底:自动 reject。 */
  private async handleTimeout(requestID: string): Promise<void> {
    const entry = this.pending.get(requestID)
    if (!entry) return
    this.cleanup(requestID)
    console.warn(`[permission-card] timeout for ${requestID},自动 reject 解锁`)
    await this.replyToOpencode(requestID, entry.sessionID, "reject")
  }

  /**
   * 调 opencode SDK permission.reply。失败仅 log,不重试 — opencode 内部会因
   * pending.delete 后等不到 reply 卡死,user 飞书侧再触发新消息会创建新 session 解锁。
   */
  private async replyToOpencode(
    requestID: string,
    _sessionID: string,
    reply: PermissionReply,
  ): Promise<void> {
    try {
      const permClient = (this.opts.opencodeClient as unknown as { permission?: { reply?: Function } })
        .permission
      if (!permClient || typeof permClient.reply !== "function") {
        console.error(`[permission-card] SDK client.permission.reply not available`)
        return
      }
      await permClient.reply({
        path: { requestID },
        query: { directory: this.opts.workspaceDir },
        body: { reply },
      })
    } catch (err) {
      console.error(`[permission-card] permission.reply API failed for ${requestID}:`, err)
    }
  }

  /** 清理 pending entry 的内存 + timer */
  private cleanup(requestID: string): void {
    const entry = this.pending.get(requestID)
    if (!entry) return
    clearTimeout(entry.timeoutHandle)
    this.pending.delete(requestID)
  }

  /** 测试 / debug:列 pending 数 */
  get size(): number {
    return this.pending.size
  }

  /** plugin 退出时清理(避免 timer leak)*/
  abortAll(): void {
    for (const requestID of Array.from(this.pending.keys())) {
      this.cleanup(requestID)
    }
  }
}
