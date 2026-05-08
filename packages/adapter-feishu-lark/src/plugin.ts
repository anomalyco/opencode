// [fork-only] adapter-feishu-lark — opencode plugin entrypoint
// [feat: feishu-bridge] 2026-05-09
//
// 对齐 OpenClaw channel plugin 模式:
//   - 跑在 opencode-cli sidecar 进程内(动态 import 加载)
//   - PluginInput.client 是 in-process SDK client(自动 attach 当前 instance)
//   - 0 修改 opencode / DeskFox 主程序
//
// 注册到 user `~/.config/opencode/opencode.json`:
//   { "plugin": ["@opencode-ai/adapter-feishu-lark/plugin"] }
//
// plugin 启动流程:
//   1. listAccounts() 读 ~/.opencode/feishu-config.json
//   2. 每个 enabled account 起飞书 WSS 长连接(@larksuiteoapi/node-sdk WSClient)
//   3. WSS 收到飞书消息 → MessagePipeline → input.client.session.create + promptAsync
//   4. 注册 plugin event hook → PromptDispatcher 累积 token → session.idle 时 resolve
//   5. lark.im.v1.message.create 发回飞书

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { listAccounts } from "./feishu/account-store"
import { MessagePipeline } from "./feishu/message-pipeline"
import { PromptDispatcher } from "./feishu/prompt-dispatcher"
import { WSSClientManager, type ImMessageEvent } from "./feishu/wss-client"

/**
 * Plugin 模块级单例 — multi-instance 场景下避免 N 个 WSS。
 * 第一次 plugin 实例化时建,后续实例化复用。
 */
let initialized = false
let dispatcher: PromptDispatcher | null = null
let wssManager: WSSClientManager | null = null
const pipelines = new Map<string, MessagePipeline>()

export const FeishuBridgePlugin = async (input: PluginInput): Promise<Hooks> => {
  // 多 instance 复用 dispatcher;每个 instance hook 都 dispatch event(其它 instance 的
  // event 不会含我们 register 的 sessionID,会被静默丢弃)
  if (!dispatcher) {
    dispatcher = new PromptDispatcher()
  }
  const localDispatcher = dispatcher

  if (!initialized) {
    initialized = true
    void initBackground(input).catch((err) => {
      console.error("[feishu-plugin] background init error:", err)
    })
  } else {
    // 后续 instance:用 input.client 注册 / 替换 pipeline 的 client
    // (不同 instance 的 client attach 不同 directory,但飞书 chat 跨 instance 共享同一 session map,
    //  所以这里我们只用第一个 instance 的 client。later instance 的 client 不替换。)
    // FUTURE:multi-instance 路由策略
  }

  return {
    event: async ({ event }) => {
      localDispatcher.dispatch(event as { type: string; properties?: Record<string, unknown> })
    },
  }
}

async function initBackground(input: PluginInput): Promise<void> {
  const accounts = listAccounts()
  if (accounts.length === 0) {
    console.log("[feishu-plugin] no accounts bound, WSS not started")
    return
  }

  // 用 input.client(in-process SDK,自动 attach 当前 instance)
  for (const { accountId, account } of accounts) {
    if (!account.enabled) continue
    pipelines.set(
      accountId,
      new MessagePipeline({
        account,
        accountId,
        opencodeClient: input.client,
        dispatcher: dispatcher!,
      }),
    )
  }

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

  await wssManager.sync(accounts)
  console.log(
    `[feishu-plugin] started: WSS=${wssManager.size}/${accounts.length} pipelines=${pipelines.size}`,
  )
}

// 默认 export = plugin 函数(opencode plugin loader 期望 default 或 server export)
export default FeishuBridgePlugin
export const server = FeishuBridgePlugin
