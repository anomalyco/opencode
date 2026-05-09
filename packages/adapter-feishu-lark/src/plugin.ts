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

import { mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { listAccounts } from "./feishu/account-store"
import { ChatSessionStore } from "./feishu/chat-session-store"
import { MessagePipeline } from "./feishu/message-pipeline"
import { PromptDispatcher } from "./feishu/prompt-dispatcher"
import { WSSClientManager, type ImMessageEvent } from "./feishu/wss-client"
import { startServer, type ServerReadyData } from "./server"

/** plugin server ready 信息 → 写到此文件给 DeskFox 主进程读 */
const PLUGIN_SERVER_PATH = join(homedir(), ".opencode", "feishu-plugin-server.json")
/** 飞书桥接专用 workspace — 跟 user 主窗口任何项目隔离 */
const FEISHU_WORKSPACE = join(homedir(), ".opencode", "feishu-workspace")

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
      localDispatcher.dispatch(event as { type: string; properties?: Record<string, unknown> })
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
  // 0. 确保飞书专用 workspace 目录存在(plugin 创建的 session 都在这跑)
  try {
    mkdirSync(FEISHU_WORKSPACE, { recursive: true })
  } catch (err) {
    console.warn(`[feishu-plugin] mkdir ${FEISHU_WORKSPACE} failed:`, err)
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
  console.log(`[feishu-plugin] server: ${handle.url} workspace=${FEISHU_WORKSPACE}`)

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
    wssManager = new WSSClientManager(async (event: ImMessageEvent) => {
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
    })
  }

  await wssManager.sync(accounts)
  console.log(
    `[feishu-plugin] synced: WSS=${wssManager.size}/${accounts.length} pipelines=${pipelines.size}`,
  )
}

// 默认 export = plugin 函数(opencode plugin loader 期望 default 或 server export)
export default FeishuBridgePlugin
export const server = FeishuBridgePlugin
