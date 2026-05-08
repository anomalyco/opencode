// [fork-only] adapter-feishu-lark entrypoint(给 Tauri 主进程 spawn 用)
// [feat: feishu-bridge] 2026-05-08
//
// 启动 localhost server,把 ServerReadyData 一行 JSON 打到 stdout(第 1 行),
// Tauri 主进程读到此行后即认为 adapter 就绪。后续 stdout 走日志(JSONL,可选)。
//
// dev:bun run packages/adapter-feishu-lark/src/main.ts
// release:打包成 sidecar binary(`bun build --compile`),路径
//         packages/desktop/src-tauri/sidecars/feishu-adapter-<target-triple>
//         build pipeline 改造留 backlog(Phase 7 之前完成)

import { listAccounts } from "./feishu/account-store"
import { WSSClientManager, type ImMessageEvent } from "./feishu/wss-client"
import { startServer } from "./server"

const handle = startServer({
  // 默认 0(随机端口);可通过 env 覆盖(测试 / 调试用)
  port: process.env.FEISHU_ADAPTER_PORT
    ? Number.parseInt(process.env.FEISHU_ADAPTER_PORT, 10)
    : undefined,
  username: process.env.FEISHU_ADAPTER_USERNAME,
  password: process.env.FEISHU_ADAPTER_PASSWORD,
})

// ============================================================
// WSS 长连接 — adapter 启动时按已绑定 accounts 起连接
// ============================================================

const wssManager = new WSSClientManager(async (event: ImMessageEvent) => {
  // C2.WSS:先只 console.log,验证事件能到 adapter
  // C2.PIPELINE 时此处接 message-pipeline:event → opencode prompt_async → SSE 回写
  console.log(
    JSON.stringify({
      tag: "feishu-message-received",
      accountId: event.accountId,
      chatId: event.chatId,
      chatType: event.chatType,
      messageId: event.messageId,
      messageType: event.messageType,
      senderOpenId: event.senderOpenId,
      mentions: event.mentions,
      contentPreview: event.content.slice(0, 200),
    }),
  )
})

void (async () => {
  try {
    const accounts = listAccounts()
    if (accounts.length === 0) {
      console.log("[adapter] no accounts bound, WSS not started")
      return
    }
    await wssManager.sync(accounts)
    console.log(`[adapter] WSS clients started: ${wssManager.size}/${accounts.length}`)
  } catch (err) {
    console.error("[adapter] WSS init error:", err)
  }
})()

const cleanup = () => {
  handle.stop()
  process.exit(0)
}

process.on("SIGTERM", cleanup)
process.on("SIGINT", cleanup)
