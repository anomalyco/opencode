# @opencode-ai/adapter-feishu-lark

[fork-only] DeskFox 飞书 / Lark IM 桥接 adapter。

> **不与 anomalyco/opencode 上游同步** — fork 自加 workspace,完全外挂在 fork 仓内。
> 跟随 spec [`docs/features/feishu-bridge/1-spec.md`](../../docs/features/feishu-bridge/1-spec.md) 实施。

## 这是什么

让 DeskFox 用户在**飞书 / Lark 里发消息**,触发 DeskFox 在**自己电脑上干活**(读文件 / 跑命令 / 调本地 LLM),流式把结果发回飞书。

核心机制:

```
飞书云端 ←─WSS─→ adapter-feishu-lark ←─HTTP─→ opencode-cli sidecar
                       ↓ HTTP
                  DeskFox GUI(Tauri webview)
```

## scope

- ✅ OAuth Device Flow 扫码绑定主用户(无需在飞书开发者后台手动建应用)
- ✅ 6 类事件长连接(消息 / 表情 / 加退群 / 视频会议 / 文档评论 / 卡片点击)
- ✅ 消息 → opencode `prompt_async` → SSE 流式 → 飞书消息节流回写
- ✅ permission ask 卡片(approve/deny)
- ✅ chatQueue 同会话串行 + dedup 防重复
- ✅ 副用户 6 位绑定码加入流程
- ✅ AskUserQuestion 主动反问(form 卡片 + synthetic message)
- ✅ heartbeat 主动定时消息(cron + activeHours)
- ✅ 多账号(挂多家飞书企业)+ 群组级独立配置
- ✅ threadSession 线程隔离

## scope 外

- ❌ 飞书业务 skill(create-doc / calendar / bitable 等)— 留 plugin slot 给中期 MCP 路径,v1 不内置

## 启动

详情见 [`docs/features/feishu-bridge/2-plan.md`](../../docs/features/feishu-bridge/2-plan.md)。

```bash
bun test           # 单元测试
bun typecheck      # 类型检查(参与仓根 turbo)
bun run probe-feishu-oauth  # 探针:实测飞书 OAuth Device Flow 接口(CI 周跑,R1 风险预警)
```
