// [fork-only] adapter-feishu-lark sidecar entrypoint(给 DeskFox GUI spawn 用)
// [feat: feishu-bridge] 2026-05-09 v3(plugin 架构)
//
// **职责切分**(plugin 模式重构后):
//   - 本 sidecar:只做 OAuth Device Flow + account CRUD(写 ~/.opencode/feishu-config.json)
//   - 真正的飞书 WSS / 消息处理 / 跟 opencode 通信:都在 opencode plugin 内(src/plugin.ts)
//
// 启动流程:
//   1. 起 localhost HTTP server(/oauth/* + /accounts/*)
//   2. stdout 第 1 行打 ServerReadyData JSON,DeskFox 主进程读取后通过 invoke 转发给 GUI

import { startServer } from "./server"

const handle = startServer({
  port: process.env.FEISHU_ADAPTER_PORT
    ? Number.parseInt(process.env.FEISHU_ADAPTER_PORT, 10)
    : undefined,
  username: process.env.FEISHU_ADAPTER_USERNAME,
  password: process.env.FEISHU_ADAPTER_PASSWORD,
})

console.log(
  "[adapter-sidecar] OAuth + accounts CRUD ready. WSS / messaging 由 opencode plugin 处理",
)

const cleanup = () => {
  handle.stop()
  process.exit(0)
}

process.on("SIGTERM", cleanup)
process.on("SIGINT", cleanup)
