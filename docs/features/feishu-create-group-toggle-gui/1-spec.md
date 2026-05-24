---
feat-id: feishu-create-group-toggle-gui
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-create-group-toggle-gui — 1-spec(需求 + 验收)

## 背景

`feishu-bridge-light` Phase 3 落地了 `[CREATE_GROUP:群名]` marker 协议 + double-gating(账号级 `enableAutoGroupCreate` opt-in + p2p chatType 闸 + 飞书 confirm 卡片二次确认)。但 **该开关只在 `~/.opencode/feishu-config.json` 配置文件里**,user 须手动编辑 JSON + 重启 DeskFox 才能启用。

2026-05-24 user 实测发现:用同一个 bot 经 LLM 来改这个 flag 走得通,但有 3 个隐患 — ① LLM 不知道改完要重启,会 reply "已生效"误导 ② imbot edit 默认 allow 不弹卡,user 不知道 LLM 改过 ③ sidecar 无文件 watcher,改完不 hot-reload。

**根本结论**:这个 flag 应在 GUI 暴露,跟现有"编辑账号模型"(`feishu-edit-account-dialog.tsx`)同 dialog 加 checkbox,走已有的"GUI → Tauri → plugin server → onAccountsChanged 触发 wssManager.sync()"热更新路径,user 控制 + 立即生效 + LLM 无法默改。

## 用户视角(交付物)

**user 操作**:Settings → 飞书桥接 → 账号列表 → 选某账号【编辑】→ 弹出对话框 → **新看到"高级能力"分隔块,内含"☐ 允许 AI 自动创建新群" checkbox** → 勾上 + 保存 → 立即生效(无需重启)。

跟之前任意一个 Bot 在飞书私聊里说"帮我建群叫 X" → 飞书收到一张【🆕 创建群【X】?】confirm 卡片(`feishu-bridge-light` 既有逻辑)→ 点【✅ 确认】 → 真建群。

## 验收标准

### 功能
1. ✅ "编辑账号模型" dialog 升级为 "编辑账号设置",含 2 分隔块:
   - **模型** 段:保持原 "跟随 DeskFox 默认 + provider/model" 表单不变
   - **高级能力** 段:1 个 checkbox "允许 AI 自动创建新群" + 副标说明(默认关 防 prompt injection 诱导 / 开后私聊说"帮我建群" AI 会发确认卡)
2. ✅ checkbox 默认值反映 account 当前 `enableAutoGroupCreate`(false 时不勾,true 时勾上)
3. ✅ 【保存】按钮一次提交两组 settings(model 改动 + flag 改动 任意子集),partial update 走单 HTTP API
4. ✅ 保存成功后 sidecar 立即 hot-reload(账号无需重连飞书 WSS,因 wssManager.sync() 复用 connection)
5. ✅ 用户接着在飞书私聊里测 `[CREATE_GROUP:]` 应能触发(发出 confirm 卡片)

### 数据
6. ✅ `~/.opencode/feishu-config.json` 中对应 account 的 `enableAutoGroupCreate` 字段持久化 false → true(或反向)
7. ✅ 已存在的其他字段(threadSession / tables / blockStreamingCoalesce / appId / appSecret / openId / tokenStore 等)**不被覆盖**

### 行为不回归
8. ✅ 旧用例(只改 model)不挂 — 保留 "model only" payload 兼容
9. ✅ 已绑 + 加载的飞书 WSS connection 不重连(避免无意义 reconnect 风暴)
10. ✅ 不通过 GUI 修改 flag 的话(即 user 不开此 dialog),配置 + 行为完全跟之前一致(0 regression)

### 测试 / 治理
11. ✅ R5 Medium ≥ 3 unit:覆盖 server partial update / account-store 合并语义 / 前端 dialog 状态正确(可选 helper extract)
12. ✅ bun run typecheck 16/16 通过
13. ✅ 三文档全套 + INDEX + 改动日志 entry

## 非目标(Out of scope)

- 不暴露其他 flag(threadSession / tables / blockStreamingCoalesce)— 各起独立 feat,本笔仅 enableAutoGroupCreate
- 不加 file watcher 让外部直接编辑 JSON 也 hot-reload(治理层独立讨论)
- 不收紧 imbot agent 对 `~/.opencode/feishu-config.json` 的 edit 权限(那是独立 attack surface,需另起 feat 评估)
- 不改 `[CREATE_GROUP:]` 触发逻辑本身(`feishu-bridge-light` 已完成)
- 不改飞书 confirm 卡片 UI(`feishu-bridge-light` 已完成)

## 安全 / 边界

- **双门控保留**:flag=true 后仍需 `chatType === "p2p"`(群里不准 AI 建群,防递归)+ 飞书 confirm 卡片 user 二次确认才真建
- **GUI 改 flag = user 显式同意**,跟 LLM 改 JSON(默 allow 不告知)形成对比,这是本 feat 安全价值核心
- **partial update 校验**:server 端必须 reject 空 payload 防 noop;reject 未知字段 防 schema injection;reject 不存在的 accountId

## 决策轨迹

- **UI 布局**:user 选"同 dialog 加分隔块"(Recommended),原因:user 不在多个入口间跳转,一次设完;dialog title 改成"编辑账号设置"容纳未来多项
- **API 设计**:user 选 Option A(扩 `updateAccountModel` → `updateAccountSettings`),原因:DeskFox 未来加更多 settings 是大概率事件,partial 模式扩展性好,zod `.partial().refine()` 实现成本低
- **feat-id 命名**:`feishu-create-group-toggle-gui`(贴交付物语义,避免业务无限扩大,符合 CLAUDE.md 元原则)
- **不立 attack-surface backlog 条目同步本笔**:那 3 项(feishu-config.json edit 收紧 / sidecar file watcher / 通过 LLM 改 config 的官方支持)是独立治理决策,本笔不挂

## 关联

- 上游 spec:`docs/features/feishu-bridge-light/1-spec.md`(原始 `enableAutoGroupCreate` 字段定义)
- 上游 changelog:`docs/features/feishu-bridge-light/3-changelog.md`
- schema:`packages/adapter-feishu-lark/src/core/config-schema.ts:136`
- pipeline gating:`packages/adapter-feishu-lark/src/feishu/message-pipeline.ts:230, 460`
