// [fork-only] @opencode-ai/adapter-feishu-lark 入口
// [feat: feishu-bridge] 2026-05-08
//
// 飞书 / Lark IM 桥接 adapter — 详情见 docs/features/feishu-bridge/
//
// 三层结构:
//   - core/   跨 IM 抽象(为以后钉钉 / 企微 / Slack 留接口)
//   - feishu/ 飞书 / Lark 专属:OAuth/WSS/节流/permission/AskUserQuestion/...
//   - server  localhost HTTP server,DeskFox GUI 调

export const VERSION = "0.0.1"
