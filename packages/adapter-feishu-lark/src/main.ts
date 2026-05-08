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

import { startServer } from "./server"

const handle = startServer({
  // 默认 0(随机端口);可通过 env 覆盖(测试 / 调试用)
  port: process.env.FEISHU_ADAPTER_PORT
    ? Number.parseInt(process.env.FEISHU_ADAPTER_PORT, 10)
    : undefined,
  username: process.env.FEISHU_ADAPTER_USERNAME,
  password: process.env.FEISHU_ADAPTER_PASSWORD,
})

const cleanup = () => {
  handle.stop()
  process.exit(0)
}

process.on("SIGTERM", cleanup)
process.on("SIGINT", cleanup)

// 防 Bun 主线程退出 — server 持有 listener 即足够,但显式 keep-alive 更稳
// (server.stop() 时 unref'd timer 会让 process 自然 exit)
