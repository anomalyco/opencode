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
//   6. 30min 超时无响应 → 自动 reply "reject" 解锁(对齐 promptTimeoutMs 默认 30min)
//
// 类比 OpenClaw `tools/ask-user-question.js`,但走 opencode 标准 SDK + Bus event 而非内嵌 runtime。

import type { Client } from "@larksuiteoapi/node-sdk"
import type { OpencodeSDKClient } from "./message-pipeline"

/** 默认 30 分钟超时(对齐 promptTimeoutMs 默认 30min,2026-05-11 imbot v2 务实档调整;
 *  v1 5min 太短 — user 在飞书慢慢点完整 ship 流程很容易撞,且对齐 prompt timeout 才不会出现
 *  "permission card 已 auto-reject 但 prompt 还在等" 的状态不一致)*/
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

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

/** "已确认"状态显示文案 + header 颜色 */
const SETTLED_DISPLAY: Record<PermissionReply | "timeout", { text: string; color: string }> = {
  once: { text: "✅ 已允许一次", color: "green" },
  always: { text: "🟢 已始终允许", color: "green" },
  reject: { text: "🛑 已拒绝", color: "red" },
  timeout: { text: "⏰ 已超时(自动拒绝)", color: "grey" },
}

/**
 * 渲染"已确认"卡片 — user 点过按钮(或超时)后,patch 替换原卡片显示新状态。
 *
 * 关键变化跟原卡片对比:
 *   - header.template:orange → green/red/grey(根据 reply)
 *   - header.title:加 settled 后缀
 *   - 移除 action 段(actions 里 3 个 button 不再显示,user 无法再点)
 *   - 加 note 段显示选择 + 时间(本期简版,只显示选择,不带时间戳)
 *   - patterns + metadata block 保留(让 user 看到 history 上下文)
 */
export function buildSettledCard(
  request: PermissionRequest,
  reply: PermissionReply | "timeout",
): InteractiveCard {
  const { emoji: permEmoji, label: permLabel } = displayFor(request.permission)
  const { text: settledText, color: headerColor } = SETTLED_DISPLAY[reply]

  // 复用原卡片的 patterns + metadata 渲染逻辑,但 elements 不再含 action
  const shownPatterns = request.patterns.slice(0, 5)
  const restCount = request.patterns.length - shownPatterns.length
  const patternsLines = shownPatterns.map((p) => `\`${truncate(p, 150)}\``).join("\n")
  const patternsBlock =
    patternsLines + (restCount > 0 ? `\n…还有 ${restCount} 项` : "")

  const metaLines: string[] = []
  for (const [k, v] of Object.entries(request.metadata)) {
    if (typeof v === "string") {
      metaLines.push(`**${k}**:\`${truncate(v, 200)}\``)
    } else if (typeof v === "number" || typeof v === "boolean") {
      metaLines.push(`**${k}**:${v}`)
    }
  }

  const elements: Array<unknown> = [
    {
      tag: "div",
      text: { tag: "lark_md", content: patternsBlock || "_(无路径)_" },
    },
  ]
  if (metaLines.length > 0) {
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: metaLines.join("\n") },
    })
  }
  elements.push({
    tag: "note",
    elements: [{ tag: "plain_text", content: settledText }],
  })

  return {
    config: { update_multi: true, wide_screen_mode: true },
    header: {
      title: {
        tag: "plain_text",
        content: `${permEmoji} ${permLabel} — ${settledText}`,
      },
      template: headerColor,
    },
    elements,
  }
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
  /** PermissionRequest 缓存 — 用 user reply 后渲染 settled 卡片需要原 request 内容 */
  request: PermissionRequest
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
      request,
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
        `[permission-card] sent card for request ${request.id} (${request.permission}) to chat ${chatId} cardMessageId=${cardMessageId ?? "MISSING"}`,
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
   * 路由:取 requestID 对应 pending → 调 opencode reply → patch 卡片成已确认状态 → 清理。
   */
  async handleReply(parsed: ParsedCardAction): Promise<void> {
    const entry = this.pending.get(parsed.requestID)
    if (!entry) {
      console.warn(`[permission-card] no pending for ${parsed.requestID} (already replied or expired)`)
      return
    }
    // 撤回原卡片 + 发已确认状态卡(B1 路径,飞书 patch 不主动刷 client,改 delete + send 新卡)
    await this.replaceWithSettledCard(entry, parsed.reply)
    this.cleanup(parsed.requestID)
    console.log(
      `[permission-card] user replied ${parsed.reply} for ${parsed.requestID} (chat=${entry.chatId})`,
    )
    await this.replyToOpencode(parsed.requestID, entry.sessionID, parsed.reply)
  }

  /** 5min 超时兜底:自动 reject + 撤回原卡片 + 发"已超时"卡片。 */
  private async handleTimeout(requestID: string): Promise<void> {
    const entry = this.pending.get(requestID)
    if (!entry) return
    await this.replaceWithSettledCard(entry, "timeout")
    this.cleanup(requestID)
    console.warn(`[permission-card] timeout for ${requestID},自动 reject 解锁`)
    await this.replyToOpencode(requestID, entry.sessionID, "reject")
  }

  /**
   * 撤回原卡片 + 发"已确认"状态新卡片(B1 视觉反馈路径)。
   *
   * 为何 delete + send 不用 patch:飞书 patch API 接受新内容(server 返 code=0),但
   * client 不主动 re-fetch 已渲染卡片,user 看到的还是原 3 button 卡。delete + send 强制
   * client 重新接收消息,视觉刷新可靠 — 代价是 chat 历史多一条"消息已撤回"小灰字提示,可接受。
   *
   * 失败 silent log — replyToOpencode 是主路径,卡片视觉是 nice-to-have。
   * cardMessageId 缺失(原 sendCard 失败那种)直接跳 delete 这步,只发新卡(原卡片不存在故不需撤)。
   */
  private async replaceWithSettledCard(
    entry: PendingCard,
    reply: PermissionReply | "timeout",
  ): Promise<void> {
    // 1. 尝试撤回原卡片(没 cardMessageId 跳过)
    if (entry.cardMessageId) {
      try {
        await this.opts.larkClient.im.v1.message.delete({
          path: { message_id: entry.cardMessageId },
        })
        console.log(`[permission-card] deleted original card ${entry.cardMessageId}`)
      } catch (err) {
        console.warn(`[permission-card] delete original card failed for ${entry.request.id}:`, err)
        // 撤回失败不阻断,继续发新卡片(user 会看到旧卡片+新卡片并存)
      }
    }
    // 2. 发已确认状态卡片到同一 chat
    try {
      const settledCard = buildSettledCard(entry.request, reply)
      await this.opts.larkClient.im.v1.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: entry.chatId,
          msg_type: "interactive",
          content: JSON.stringify(settledCard),
        },
      })
      console.log(`[permission-card] sent settled card to chat ${entry.chatId} → ${reply}`)
    } catch (err) {
      console.warn(`[permission-card] send settled card failed for ${entry.request.id}:`, err)
    }
  }

  /**
   * 调 opencode SDK 回放权限响应。
   *
   * v1 SDK(我们 adapter 用的 `@opencode-ai/sdk`)接口:
   *   client.postSessionIdPermissionsPermissionId({
   *     path: { id: <sessionID>, permissionID: <requestID> },
   *     query: { directory },
   *     body: { response: "once" | "always" | "reject" }   ← 字段名 response 不是 reply
   *   })
   * 走 POST /session/{id}/permissions/{permissionID}
   *
   * 失败仅 log,不重试 — opencode 内部会因 pending 等不到 reply 卡死,user 飞书侧再触发
   * 新消息会创建新 session 解锁。
   */
  private async replyToOpencode(
    requestID: string,
    sessionID: string,
    reply: PermissionReply,
  ): Promise<void> {
    try {
      const client = this.opts.opencodeClient as unknown as {
        postSessionIdPermissionsPermissionId?: (args: unknown) => Promise<unknown>
      }
      if (typeof client.postSessionIdPermissionsPermissionId !== "function") {
        console.error(`[permission-card] SDK postSessionIdPermissionsPermissionId not available`)
        return
      }
      await client.postSessionIdPermissionsPermissionId({
        path: { id: sessionID, permissionID: requestID },
        query: { directory: this.opts.workspaceDir },
        body: { response: reply },
      })
    } catch (err) {
      console.error(`[permission-card] permission reply API failed for ${requestID}:`, err)
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
