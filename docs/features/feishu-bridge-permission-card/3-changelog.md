---
feat-id: feishu-bridge-permission-card
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-bridge-permission-card — changelog

## 一句话

修飞书 user 任务被 opencode 权限对话框卡死的死锁(GUI 弹"需要权限"对话框,飞书 user 看不到 → agent 永远等)— 拦截 `permission.asked` Bus event,渲染飞书 CardKit 交互卡片,user 在飞书显式选[允许一次/始终允许/拒绝],plugin 调 `client.postSessionIdPermissionsPermissionId` 回写 opencode 解锁。**保持 user 显式批准的 trust 边界**,不做 auto-allow。

> Medium 规模:7 文件 / +1198 行核心代码 + 测试 / 0 R4 / 0 上游侵入 / 5 笔 commit(实测踩 4 个坑陆续修)。

## commit 列表(实施 → 实测 → 修)

| commit | 内容 |
|---|---|
| `5e02c0bf9` | **feat**(主笔):`permission-card.ts` 新 370 行(buildPermissionCard / parseCardAction / PermissionCardController)+ pipeline 内嵌 controller + WSS 接 card.action.trigger + plugin 路由 + 23 单测 |
| `889476be9` | **fix**:走 v1 SDK `postSessionIdPermissionsPermissionId` 不是 v2 `client.permission.reply` — 实测 user 点[允许一次]后日志报 `SDK client.permission.reply not available`,因为 adapter-feishu-lark 用 `@opencode-ai/sdk` v1(没 permission namespace),v1 接口是顶层方法,body 字段是 `response` 不是 `reply` |
| `10ec4cab7` | **feat**:点击后 patch 卡片显示已确认状态(header 绿/红/灰 + 移除按钮)+ 4 单测覆盖 once/reject/timeout/patch fail |
| `18a898830` | **fix**:patch API 调成功(server 返 code=0)但飞书 PC + 手机两端都不刷新已渲染卡片 — patch 是 server-side 操作 client 不主动 re-fetch。改 `delete + send` 路径(B1):撤回原卡片 + 发新 settled 卡。chat 多一条"消息已撤回"小灰字提示,可接受 |
| `96f2c38dd` | **fix**:`findLastUsefulAssistant` 加 parentID 约束 — 实测 reject 后 LLM 无 text + 无 `info.error`,Layer 1 倒序找 last assistant 跨轮回退到上一轮 → 把上一轮答案重发到飞书 → user 看到红色已拒绝卡片 + 仍收到旧答案,严重 UX/安全感问题。修法:helper 加 userMsgId 参数,只取 parentID 匹配的 assistant;runOpencode 调用前先找 last user msg id 传过去。本轮无 useful assistant 返空字符串(plugin 不发飞书,符合 reject 真断了语义)|

## 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/adapter-feishu-lark/src/feishu/permission-card.ts`(新) | ~430 行 | `buildPermissionCard` 渲染请求卡片 + `buildSettledCard` 渲染确认状态卡片 + `parseCardAction` 解析飞书 action.trigger event + `PermissionCardController` 状态管理(start/handleReply/handleTimeout/replaceWithSettledCard/replyToOpencode)|
| `packages/adapter-feishu-lark/src/feishu/__tests__/permission-card.test.ts`(新) | ~370 行 / 28 测试 | buildPermissionCard 6 case + parseCardAction 7 case + PermissionCardController 15 case(start/handleReply/timeout/dup/sendCard fail/settled card 渲染 / delete+send 失败兜底)|
| `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts`(改) | +50 行 | 内嵌 PermissionCardController + sessionToChat 反查 Map + handlePermissionAsked / handleCardActionReply 路由方法 + findLastUsefulAssistant 加 userMsgId 参数 + runOpencode 取 last user msg id 传过去 |
| `packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts`(改) | +90 行 / +7 测试 | parentID 约束新增 7 case(本轮无 useful 返 undefined / 跨轮 r1 vs 本轮 r2 / ghost 在 real 前后 / reject 路径主修 / 本轮 error / userMsgId 不存在防御)|
| `packages/adapter-feishu-lark/src/feishu/wss-client.ts`(改) | +30 行 | OnCardActionHandler 类型 + 注册 `card.action.trigger` handler + WSSClientManager 加 onCardAction 路由 |
| `packages/adapter-feishu-lark/src/plugin.ts`(改) | +35 行 | event hook 加 permission.asked 路由(找拥有 sessionID 的 pipeline → 调 handlePermissionAsked)+ WSSClientManager 配 onCardAction 路由(parseCardAction → handleCardActionReply)|
| `docs/features/feishu-bridge-permission-card/{1-spec,2-plan}.md`(新) | 已落盘 | spec + plan(Medium 标准三文档)|

## 完整调研要点

### opencode permission system 暴露的 API(0 上游侵入用上)

**Bus event(plugin 监听用)**:
```
permission.asked: BusEvent<{ id, sessionID, permission, patterns, metadata, always, tool }>
permission.replied: BusEvent<{ sessionID, requestID, reply }>
```

**SDK API(plugin 调用回写)**:
```
v1 SDK(我们用):  client.postSessionIdPermissionsPermissionId({path:{id, permissionID}, body:{response: "once"|"always"|"reject"}})
v2 SDK(未用):    client.permission.reply({path:{requestID}, body:{reply}})
```

**Reply 类型**:
- `once` — 当次允许,下次再问
- `always` — 永久允许,加 ruleset 规则后续相同 pattern 自动放行
- `reject` — 拒绝,tool call 抛 RejectedError;附 message 时变 CorrectedError 给 LLM 看到反馈

**10 类权限**:`edit / external_directory / read / glob / grep / lsp / skill / todowrite / webfetch / websearch`

### 飞书 CardKit 接入

**发卡片**:`larkClient.im.v1.message.create({msg_type: "interactive", content: JSON.stringify(<InteractiveCard>)})`

**接 user 点击**:WSS EventDispatcher 注册 `card.action.trigger` handler — payload `{ open_id, open_message_id, token, action: { value, tag } }`,从 `action.value` 取我们 button 编码的 `{kind, requestID, reply}`

**视觉反馈**:`im.v1.message.delete` + `im.v1.message.create` 重发(B1 路径)— `im.v1.message.patch` 飞书 client 不主动刷新

## 4 个实测踩坑沉淀

1. **v1 vs v2 SDK** — adapter 用 v1 client 没 `permission` namespace,直查 `postSessionIdPermissionsPermissionId` 顶层方法,body 字段是 `response` 不是 `reply`
2. **patch 不刷新视觉** — 飞书 server 接受了 patch(返 code=0)但 PC + 手机两端 client 都不主动 re-fetch 已渲染卡片;改 delete + create 强制刷新
3. **reject 路径回放前轮答案** — Layer 1 `findLastUsefulAssistant` 跨轮回退到上一轮 assistant,把旧答案当本轮答案发飞书;加 parentID 约束修
4. **LLM session memory 不可控** — 同 chat 多轮内,LLM 知道的事 reject 拦不住(LLM 从 context 直接答),reject 真正能阻止的是"LLM 还不知道的信息"。这是模型层面行为,plugin 层管不到 — 已记入文档

## 验收实测(2026-05-11 user 飞书 Hebing—one 账号)

| # | 用例 | 结果 |
|---|---|---|
| 1 | 允许一次 happy path | ✅ 用户点[允许一次] → settled 卡片绿 + LLM read 文件 + reply provider 列表 |
| 2 | 始终允许 | ⏳ 单测覆盖,真飞书未实测(下次复测时验)|
| 3 | 拒绝 | ✅ parentID 修后,本轮无 useful 返空,plugin 不发飞书(原 bug:回放上一轮答案)|
| 4 | timeout 5min | ✅ 单测覆盖(短 timeout 验证)|
| 5 | 多权限并发 | ✅ Controller 单测覆盖 |
| 6 | workspace 内不弹卡片 | 代码路径正确(plugin 仅在 hasSession 时介入)|
| 7 | 主 GUI 行为不变 | 代码路径正确(主 GUI session 不经过 message-pipeline,permission 走原 GUI 对话框) |

## 跟 OpenClaw 对比

| 维度 | OpenClaw | DeskFox 本笔 |
|---|---|---|
| 实现路径 | plugin 内嵌 OpenClaw runtime,直接拦截 agent loop 内"need permission"内部状态 | sandbox plugin → bus event → CardKit → SDK reply |
| 改动量 | 大量内部 SDK 集成 | 0 上游侵入,纯 fork 端代码 |
| 可移植性 | 仅 OpenClaw 体系 | opencode 标准 API,future-proof |
| **结论** | 同等用户体验,**我们路径反而更干净**(走文档化 SDK + Bus event)|

## R4 / 上游侵入

- 0 R4 override
- 0 上游侵入(全在 fork-only `adapter-feishu-lark/`)

## 跟进

- **OpenClaw 对齐 #5b**(LLM `question` 工具的真互动版)— 跟 #5a 共用 CardKit 渲染基础设施,后续做(`feishu-bridge-question-card`)
- **真飞书 e2e 测试基础设施** — 当前要 user 在飞书 IM 物理点按钮才算完整 e2e。可加 plugin server 测试 endpoint(`/test/simulate-card-action`),自动化驱动测试。留 backlog
