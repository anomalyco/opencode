// [fork-only] adapter-feishu-lark — opencode plugin entrypoint(X1 plugin 内自带 server)
// [feat: feishu-bridge] 2026-05-09
//
// 对齐 OpenClaw channel plugin 模式:
//   - 跑在 opencode-cli sidecar 进程内(动态 import 加载)
//   - PluginInput.client 是 in-process SDK client(自动 attach 当前 instance)
//   - plugin 自带 HTTP server(port 写到 ~/.opencode/feishu-plugin-server.json)
//     - DeskFox GUI 通过 Tauri command 读 port file → forward HTTP 调 plugin server
//     - server 提供 /oauth/* + /accounts/* CRUD endpoints
//   - 0 修改 opencode / DeskFox 主程序
//
// 注册到 user `~/.config/opencode/opencode.json`:
//   { "plugin": ["file:///path/to/plugin.ts"] }
//
// 架构演进路径(架构 doc 详见 docs/features/feishu-bridge/architecture.md):
//   - **现在**(单 IM):本 plugin 自带 server,简单
//   - **未来 N=2 IM**:每个 IM plugin 自带 server,GUI 配两套 port file
//   - **未来 N≥3 IM(重构点)**:造 @opencode-ai/im-bridge-core plugin 做 channel registry,
//     各 IM plugin 退化为 channel handler module 注册到 core
//
// plugin 启动流程:
//   1. 起 localhost HTTP server(/oauth/* + /accounts/*)+ 写 ~/.opencode/feishu-plugin-server.json
//   2. listAccounts() 读 ~/.opencode/feishu-config.json → 给每个 account 起飞书 WSS
//   3. WSS 收到飞书消息 → MessagePipeline → input.client.session.create + promptAsync
//   4. plugin event hook 收所有 events → PromptDispatcher 累积 token → session.idle 时 resolve
//   5. lark.im.v1.message.create 发回飞书
//   6. saveAccount/deleteAccount 后 server 触发 onAccountsChanged → hot-sync WSS

import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { readSecret } from "./core/secret-ref"
import { listAccounts, saveAccount } from "./feishu/account-store"
import { fetchBotName } from "./feishu/bot-info"
import { ChatSessionStore } from "./feishu/chat-session-store"
import { MessagePipeline } from "./feishu/message-pipeline"
import { PromptDispatcher } from "./feishu/prompt-dispatcher"
import { WSSClientManager, type ImMessageEvent } from "./feishu/wss-client"
import { startServer, type ServerReadyData } from "./server"

/** plugin server ready 信息 → 写到此文件给 DeskFox 主进程读 */
const PLUGIN_SERVER_PATH = join(homedir(), ".opencode", "feishu-plugin-server.json")

/**
 * [feat: imbot-workspace-rename] 2026-05-25
 * IM 桥接共享 home base workspace — 跟 user 主窗口任何项目隔离。所有 IM plugin
 * (飞书 / 未来 telegram / 钉钉)共用此路径(对齐 ADR `OPENCODE-PLAN/架构决策/
 * im桥接-imbot单一架构.md` "imbot 跨 IM 共享 home base"语义)。
 *
 * 老路径 `feishu-workspace`(2026-05-23 feishu-bridge-light 起)在本 feat 中
 * 重命名为 `imbot-workspace`;启动时 `migrateLegacyWorkspace` 自动迁移老用户。
 */
const LEGACY_WORKSPACE = join(homedir(), ".opencode", "feishu-workspace")
const IMBOT_WORKSPACE = join(homedir(), ".opencode", "imbot-workspace")

/**
 * [feat: imbot-workspace-rename-followup] 2026-05-25
 * `chatSessionStore`(feishu-chat-sessions.json)里 session ID 还绑老 directory
 * (feishu-workspace)→ LLM 用老 system prompt + 老 cwd → emit ATTACH 用老路径 ENOENT。
 * 修法:user 升级首次启动清 chatSessionStore 让 plugin 重建 session 用新 directory。
 * marker 文件保证幂等(只清一次)。详 docs/features/imbot-workspace-rename-followup/。
 */
const STALE_SESSIONS_CLEANUP_MARKER = join(
  homedir(),
  ".opencode",
  ".imbot-workspace-rename-cleanup-applied",
)
const CHAT_SESSION_STORE_PATH = join(
  homedir(),
  ".opencode",
  "feishu-chat-sessions.json",
)

/**
 * 把老 ~/.opencode/feishu-workspace/ 迁移到新 ~/.opencode/imbot-workspace/(原子 rename)。
 *
 * 行为表(详 `docs/features/imbot-workspace-rename/1-spec.md §测试用例`):
 *   - legacy 存在 + new 不存在 → mv,返 "migrated"
 *   - legacy 不存在 + new 存在 → no-op
 *   - 两者都不存在 → no-op(初次安装)
 *   - 两者都存在 → warn,不动(罕见 — user 自己建过)
 *   - mv 抛错 → warn + 不崩
 *
 * [feat: imbot-workspace-rename] 2026-05-25 helper extract,DI 友好测
 */
export type MigrateResult =
  | "migrated"
  | "noop-already-new"
  | "noop-no-legacy"
  | "skipped-both-exist"
  | "failed"

export function migrateLegacyWorkspace(
  legacyPath: string,
  newPath: string,
  fs: {
    existsSync: (p: string) => boolean
    renameSync: (o: string, n: string) => void
  },
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
): MigrateResult {
  const legacyExists = fs.existsSync(legacyPath)
  const newExists = fs.existsSync(newPath)
  if (!legacyExists && newExists) return "noop-already-new"
  if (!legacyExists && !newExists) return "noop-no-legacy"
  if (legacyExists && newExists) {
    logger.warn(
      `[feishu-plugin] both legacy ${legacyPath} and new ${newPath} exist — keeping new, please check legacy manually`,
    )
    return "skipped-both-exist"
  }
  // legacyExists && !newExists
  try {
    fs.renameSync(legacyPath, newPath)
    logger.info(
      `[feishu-plugin] migrated legacy workspace path ${legacyPath} → ${newPath}`,
    )
    return "migrated"
  } catch (e) {
    logger.warn(
      `[feishu-plugin] failed to migrate legacy workspace ${legacyPath} → ${newPath}: ${(e as Error).message}. Please mv manually.`,
    )
    return "failed"
  }
}

/**
 * [feat: imbot-workspace-rename-followup] 2026-05-25
 *
 * `imbot-workspace-rename`(2026-05-25 落地)只改了 home base 路径,但
 * `~/.opencode/feishu-chat-sessions.json` 里保留了重命名前创建的 opencode session
 * ID。这些 session 在 opencode 内部绑死老 directory(feishu-workspace)+ 含老
 * system prompt(ATTACH_MARKER_PROMPT 里那时候写的还是老路径)。
 *
 * 复用老 session 时,LLM 通过老 system prompt + 老 cwd 推断 → emit ATTACH marker
 * 用老路径 → 实际文件在新路径 → ENOENT 报错。
 *
 * 修法:user 升级到本 feat 版本首次启动,清掉整个 chatSessionStore 让 plugin 重建
 * session 用新 directory(IMBOT_WORKSPACE)+ 新 system prompt。marker 文件
 * (~/.opencode/.imbot-workspace-rename-cleanup-applied)保证只清一次,后续启动
 * no-op。
 *
 * Trade:user 失去所有 chat 的 multi-turn memory(one-time cost),换 stale path
 * 长期错乱修复。
 *
 * 行为表(详 docs/features/imbot-workspace-rename-followup/1-spec.md §测试用例):
 *   - marker 已存在 → "noop-already-applied"
 *   - marker 不存在 + chatStore 不存在 → 写 marker,返 "noop-no-sessions"
 *   - marker 不存在 + chatStore 存在 → 清 chatStore + 写 marker,返 "applied"
 *   - 异常 → warn,返 "failed",不崩 plugin
 */
export type CleanupResult =
  | "applied"
  | "noop-already-applied"
  | "noop-no-sessions"
  | "failed"

export function applyStaleSessionsCleanup(
  markerPath: string,
  chatSessionStorePath: string,
  fs: {
    existsSync: (p: string) => boolean
    unlinkSync: (p: string) => void
    writeFileSync: (p: string, data: string) => void
  },
  logger: { info: (m: string) => void; warn: (m: string) => void },
): CleanupResult {
  if (fs.existsSync(markerPath)) {
    return "noop-already-applied"
  }
  const markerContent = JSON.stringify(
    { appliedAt: new Date().toISOString(), feat: "imbot-workspace-rename" },
    null,
    2,
  )
  if (!fs.existsSync(chatSessionStorePath)) {
    try {
      fs.writeFileSync(markerPath, markerContent)
      return "noop-no-sessions"
    } catch (e) {
      logger.warn(
        `[feishu-plugin] failed to write cleanup marker ${markerPath}: ${(e as Error).message}`,
      )
      return "failed"
    }
  }
  // marker 不存在 + chatStore 存在 → 清 + 写 marker
  try {
    fs.unlinkSync(chatSessionStorePath)
  } catch (e) {
    logger.warn(
      `[feishu-plugin] failed to clear stale chat sessions ${chatSessionStorePath}: ${(e as Error).message}. Please rm manually + restart.`,
    )
    return "failed"
  }
  try {
    fs.writeFileSync(markerPath, markerContent)
  } catch (e) {
    logger.warn(
      `[feishu-plugin] cleared chat sessions but failed to write cleanup marker ${markerPath}: ${(e as Error).message}. Next start will clean again.`,
    )
    return "failed"
  }
  logger.info(
    `[feishu-plugin] cleared stale chat sessions after workspace rename (${chatSessionStorePath} removed, marker written)`,
  )
  return "applied"
}

/**
 * Plugin 模块级单例 — multi-instance 场景下避免 N 个 server / WSS。
 * 第一次 plugin 实例化时建,后续实例化复用。
 */
let initialized = false
let dispatcher: PromptDispatcher | null = null
let wssManager: WSSClientManager | null = null
let pluginClient: PluginInput["client"] | null = null
let chatSessionStore: ChatSessionStore | null = null
const pipelines = new Map<string, MessagePipeline>()

export const FeishuBridgePlugin = async (input: PluginInput): Promise<Hooks> => {
  if (!dispatcher) {
    dispatcher = new PromptDispatcher()
  }
  const localDispatcher = dispatcher

  if (!initialized) {
    initialized = true
    // 第一个 instance 的 client 用作所有 pipeline 的 opencode client
    pluginClient = input.client
    void initBackground().catch((err) => {
      console.error("[feishu-plugin] background init error:", err)
    })
  }
  // 后续 instance:复用第一个 client / dispatcher / wss
  // FUTURE multi-instance routing 策略

  return {
    event: async ({ event }) => {
      const evt = event as { type: string; properties?: Record<string, unknown> }
      localDispatcher.dispatch(evt)

      // permission.asked 事件 → 找拥有该 sessionID 的 pipeline → 弹飞书权限卡片
      if (evt.type === "permission.asked" && evt.properties) {
        const req = evt.properties as {
          id?: string
          sessionID?: string
          permission?: string
          patterns?: ReadonlyArray<string>
          metadata?: Record<string, unknown>
          always?: ReadonlyArray<string>
          tool?: { messageID: string; callID: string }
        }
        if (!req.id || !req.sessionID || !req.permission) return
        for (const pipeline of pipelines.values()) {
          if (pipeline.hasSession(req.sessionID)) {
            try {
              await pipeline.handlePermissionAsked({
                id: req.id,
                sessionID: req.sessionID,
                permission: req.permission,
                patterns: req.patterns ?? [],
                metadata: req.metadata ?? {},
                always: req.always ?? [],
                tool: req.tool,
              })
            } catch (err) {
              console.error(`[feishu-plugin] handlePermissionAsked error:`, err)
            }
            break
          }
        }
        // 如果没 pipeline 拥有这个 session(主 GUI / TUI session)→ 不动,
        // opencode 走原 GUI 对话框路径,user 在主 GUI 处理
      }
    },
  }
}

/**
 * 启动 server + 起 WSS。
 *
 * server 提供 /oauth/* + /accounts/* CRUD;saveAccount 后 onAccountsChanged 回调
 * 触发本地 syncAccounts() 让 wssManager 接受新账号 hot reload(0 跨进程延迟)。
 */
async function initBackground(): Promise<void> {
  // [feat: imbot-workspace-rename] 2026-05-25
  // 0a. 老路径 feishu-workspace 自动迁移到 imbot-workspace(legacy → new mv)
  migrateLegacyWorkspace(
    LEGACY_WORKSPACE,
    IMBOT_WORKSPACE,
    { existsSync, renameSync },
    { info: (m) => console.log(m), warn: (m) => console.warn(m) },
  )

  // [feat: imbot-workspace-rename-followup] 2026-05-25
  // 0a.5 清掉绑老 directory 的 stale chat sessions(marker 幂等只清一次)
  applyStaleSessionsCleanup(
    STALE_SESSIONS_CLEANUP_MARKER,
    CHAT_SESSION_STORE_PATH,
    { existsSync, unlinkSync, writeFileSync },
    { info: (m) => console.log(m), warn: (m) => console.warn(m) },
  )

  // 0b. 确保 IM 桥接共享 workspace 目录存在(plugin 创建的 session 都在这跑)
  try {
    mkdirSync(IMBOT_WORKSPACE, { recursive: true })
  } catch (err) {
    console.warn(`[feishu-plugin] mkdir ${IMBOT_WORKSPACE} failed:`, err)
  }

  // 0.5 chatId → sessionID 持久化映射(plugin 重启后同 chat 复用 session)
  chatSessionStore = new ChatSessionStore()

  // 1. 起 server(给 DeskFox GUI 调 OAuth + accounts CRUD + 列 providers)
  const handle = startServer({
    onReady: writePluginPortFile,
    onAccountsChanged: () => syncAccounts(),
    onListProviders: async () => {
      if (!pluginClient) throw new Error("opencode client not ready")
      const res = await pluginClient.config.providers()
      return (res as { data?: unknown }).data ?? res
    },
    onSimulateMessage: async (event) => {
      const pipeline = pipelines.get(event.accountId)
      if (!pipeline) throw new Error(`no pipeline for account ${event.accountId}`)
      await pipeline.testHandle({
        accountId: event.accountId,
        messageId: event.messageId,
        chatId: event.chatId,
        chatType: event.chatType,
        messageType: event.messageType,
        content: event.content,
        senderOpenId: undefined,
        ts: String(Date.now()),
        mentions: [],
      })
    },
    onDebugFetchMessages: async (accountId, sessionID) => {
      const pipeline = pipelines.get(accountId)
      if (!pipeline) throw new Error(`no pipeline for account ${accountId}`)
      return pipeline.debugFetchMessages(sessionID)
    },
  })
  console.log(`[feishu-plugin] server: ${handle.url} workspace=${IMBOT_WORKSPACE}`)

  // 2. 首次 sync(读已绑定 accounts → 起 WSS)
  await syncAccounts()
}

function writePluginPortFile(ready: ServerReadyData): void {
  try {
    const content = JSON.stringify(ready, null, 2)
    writeFileSync(PLUGIN_SERVER_PATH, content, { encoding: "utf-8", mode: 0o600 })
    console.log(`[feishu-plugin] wrote ${PLUGIN_SERVER_PATH} (0600)`)
  } catch (err) {
    console.error("[feishu-plugin] write port file failed:", err)
  }
}

/**
 * Hot-sync WSS:
 *   - listAccounts() 重读最新 config
 *   - 已存在 enabled account 的 WSSClient 不动(WSSClientManager.sync 只 add 新的)
 *   - FUTURE:account.enabled=false 或被删时 close 对应 WSSClient(SDK 没暴露 stop,留 process restart)
 */
async function syncAccounts(): Promise<void> {
  if (!pluginClient) {
    console.warn("[feishu-plugin] syncAccounts before client ready, skipping")
    return
  }

  const accounts = listAccounts()
  if (accounts.length === 0) {
    console.log("[feishu-plugin] no accounts bound")
    return
  }

  // 重建 / 新建 pipeline(让 account.model 等字段更新立即 hot 生效;
  // chatToSession 内存 cache 丢失没关系 — chatSessionStore 持久化,下次消息从 store 拉)
  const activeAccountIds = new Set(accounts.map((a) => a.accountId))
  // 删 disabled / 已移除的 account 对应 pipeline
  for (const oldId of pipelines.keys()) {
    if (!activeAccountIds.has(oldId)) {
      pipelines.delete(oldId)
    }
  }
  for (const { accountId, account } of accounts) {
    if (!account.enabled) {
      pipelines.delete(accountId)
      continue
    }
    pipelines.set(
      accountId,
      new MessagePipeline({
        account,
        accountId,
        opencodeClient: pluginClient,
        dispatcher: dispatcher!,
        chatSessionStore: chatSessionStore!,
      }),
    )
  }

  if (!wssManager) {
    wssManager = new WSSClientManager(
      async (event: ImMessageEvent) => {
        const pipeline = pipelines.get(event.accountId)
        if (!pipeline) {
          console.warn(`[feishu-plugin] no pipeline for account ${event.accountId}`)
          return
        }
        try {
          await pipeline.handle(event)
        } catch (err) {
          console.error(`[feishu-plugin] pipeline error:`, err)
        }
      },
      // onCardAction:user 在飞书点交互卡片按钮 → 路由到 pipeline
      // 当前两类卡片:permission(opencode permission.asked)/ confirm(feishu-bridge-light 自动建群等)
      async (accountId, cardEvent) => {
        const pipeline = pipelines.get(accountId)
        if (!pipeline) {
          console.warn(`[feishu-plugin] card action for unknown account ${accountId}`)
          return
        }
        const rawEvent = {
          action: { value: cardEvent.actionValue, tag: cardEvent.actionTag },
          open_id: cardEvent.openId,
          open_message_id: cardEvent.cardMessageId,
        }
        // 先尝试 permission 卡片
        const { parseCardAction } = await import("./feishu/permission-card")
        const permParsed = parseCardAction(rawEvent)
        if (permParsed) {
          try {
            await pipeline.handleCardActionReply(permParsed)
          } catch (err) {
            console.error(`[feishu-plugin] handleCardActionReply error:`, err)
          }
          return
        }
        // 再尝试 confirm 卡片(feishu-bridge-light)
        const { parseConfirmAction } = await import("./feishu/confirm-card")
        const confirmParsed = parseConfirmAction(rawEvent)
        if (confirmParsed) {
          try {
            await pipeline.handleConfirmCardReply(confirmParsed)
          } catch (err) {
            console.error(`[feishu-plugin] handleConfirmCardReply error:`, err)
          }
          return
        }
        // 不属于我们任何卡片类型,静默忽略
      },
    )
  }

  await wssManager.sync(accounts)
  console.log(
    `[feishu-plugin] synced: WSS=${wssManager.size}/${accounts.length} pipelines=${pipelines.size}`,
  )

  // 后台 best-effort 刷新 bot 名(每个 account 调一次飞书 API,有变化就回写 config)
  // 失败 / 网络不通保留旧值,不阻断;sidecar 重启 = 自然刷新触发点
  void refreshBotNamesInBackground(accounts)
}

/**
 * 对每个 enabled account 拉一次最新 bot 名。
 * 跟 db 里的不同(包括 user 飞书后台改名)→ 回写 config。失败保留旧值不覆盖。
 */
async function refreshBotNamesInBackground(
  accounts: ReturnType<typeof listAccounts>,
): Promise<void> {
  for (const { accountId, account } of accounts) {
    if (!account.enabled) continue
    try {
      const appSecret = readSecret(account.appSecret)
      const newName = await fetchBotName(account.domain, account.appId, appSecret)
      if (newName && newName !== (account.botName ?? "")) {
        // 用 saveAccount 写回(它会复用 existing 字段,只更新 botName)
        saveAccount({
          accountId,
          domain: account.domain,
          appId: account.appId,
          appSecret, // 明文,saveAccount 会再走 SecretRef 落盘(idempotent)
          openId: account.openId,
          botName: newName,
        })
        console.log(
          `[feishu-plugin] bot name refreshed: ${accountId} "${account.botName ?? ""}" → "${newName}"`,
        )
      }
    } catch (err) {
      console.warn(
        `[feishu-plugin] bot name refresh failed for ${accountId}:`,
        (err as Error).message,
      )
    }
  }
}

// 默认 export = plugin 函数(opencode plugin loader 期望 default 或 server export)
export default FeishuBridgePlugin
export const server = FeishuBridgePlugin
