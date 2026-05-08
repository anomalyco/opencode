---
feat-id: feishu-bridge
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-bridge — 2-plan(实施计划)

> **基于**:[1-spec.md](./1-spec.md)v2 锁版(2026-05-08,user 签字,5 决策点全锁)
> **总工期**:14.5 工作日(8 个 Phase)
> **分支**:`feat/feishu-bridge`(已开,起点 `8f22c4a27` 后 2026-05-08 dev)
> **测试纪律**:R5 全程,每 Phase 含 unit / 整合 测试,Phase 7 收尾保证 Logic 清单 ≥ 80% 行覆盖

---

## 总体策略

### 实施顺序原则

1. **底座先做**(Phase 0 + 0.5)— workspace 建好 + system tray 立好,后续 Phase 才能跑得起来
2. **OAuth 早出**(Phase 1)— 这是 user 看得见的第一个体验点,早走通早信心
3. **核心通道**(Phase 2-3)— 长连接 + 消息 + permission,MVP 8 项主体
4. **好用版增量**(Phase 4-6)— 在 MVP 基础上叠加 11 项,每 Phase 单一主题
5. **测试 + 文档收尾**(Phase 7)— R5 行覆盖率达标 + GUI e2e + 三文档

### commit 拆分策略

按 P4 "一笔 commit 一件事"。每 Phase 平均拆 2-4 笔 commit,按 sub-feature(配置 schema / OAuth 三步骤 / GUI 弹窗 / 等)分。整 feat ~25-35 笔 commit。

每笔 commit message 格式:
```
<type>(<scope>): <一句话> [feat: feishu-bridge]
```

### R5 测试纪律

- 每 Phase 改代码必带测试(单元 / 集成,不一定 e2e)
- Bug 修复 commit message 加 `[bug-repro: <一句话>]`,先写复现测试再 fix
- 关键模块清单(spec §8.1 已列):每改一个就跟着补测,Phase 7 收尾时直接达标

### 风险预警机制

实施中遇到 spec §7 列的 13 个风险任意一个浮出 → 在本文件 **§99 决策轨迹** 段实时追加 note,不撤回 spec(spec 锁版只补不改)。

---

## Phase 0:adapter monorepo workspace 起 + 共享基础(1.5 天)

### 目标

新建 `packages/adapter-feishu-lark/` workspace,跟仓内 7 个现有 workspace 并列。建完能 `bun install` + `bun run typecheck` + `bun test` 跑通(0 实质代码,只地基)。

### 改动文件

| 文件 | 改动 |
|---|---|
| `package.json`(根)| `workspaces` 加 `"packages/adapter-feishu-lark"` |
| `packages/adapter-feishu-lark/package.json`(新)| 名 `@opencode-ai/adapter-feishu-lark`,deps:`@larksuiteoapi/node-sdk` / `axios` / `qrcode-terminal` / `zod` |
| `packages/adapter-feishu-lark/tsconfig.json`(新)| extends 仓根 + composite + paths |
| `packages/adapter-feishu-lark/turbo.json`(新)| typecheck / test 任务 |
| `packages/adapter-feishu-lark/src/index.ts`(新)| export 入口(空 stub) |
| `packages/adapter-feishu-lark/src/core/secret-ref.ts`(新)| 三档凭证存储抽象(plaintext / env / file) |
| `packages/adapter-feishu-lark/src/core/config-schema.ts`(新)| zod schema:`accounts`/`channels.feishu`/`groups`/`heartbeat`/... |
| `packages/adapter-feishu-lark/src/core/opencode-client.ts`(新)| 调 opencode-cli sidecar 的 HTTP client(`POST /:sessionID/prompt_async` / `POST /permission/:permissionID` / SSE 订阅) |
| `packages/adapter-feishu-lark/src/__tests__/secret-ref.test.ts`(新)| 单测 ≥80% |
| `packages/adapter-feishu-lark/src/__tests__/config-schema.test.ts`(新)| 单测 ≥80% |
| `bun.lock`(根)| 自动重生(R4 override:`bun.lock`) |

### commit 拆分

| # | 主题 | 文件 |
|---|---|---|
| C0.1 | chore(deps): adapter-feishu-lark workspace setup [override-blacklist: bun.lock] | package.json + workspace 起 |
| C0.2 | feat(adapter-feishu-lark): SecretRef 三档凭证存储 + 单测 | core/secret-ref + 测试 |
| C0.3 | feat(adapter-feishu-lark): config schema(zod)+ 单测 | core/config-schema + 测试 |
| C0.4 | feat(adapter-feishu-lark): opencode HTTP client(polling/SSE) | core/opencode-client |

### 验收标准

- [ ] `bun install` 成功
- [ ] `bun run typecheck`(turbo 全量)15/15 pass
- [ ] `bun test packages/adapter-feishu-lark` 跑过
- [ ] `secret-ref.ts` 单测覆盖率 ≥ 80%
- [ ] `config-schema.ts` 单测覆盖率 ≥ 80%

---

## Phase 0.5:DeskFox 主进程 system tray + GUI 关不退主进程(1 天)

### 目标

主进程加 system tray 跨平台图标(mac menu bar / Win 任务栏 / Linux indicator)+ 关 GUI 改 hide(主进程不退)+ 状态指示。**飞书还没接,先把骨架立好**。

### 改动文件

| 文件 | 改动 |
|---|---|
| `packages/desktop/src-tauri/Cargo.toml` | 加 tauri tray feature(2 已内置) |
| `packages/desktop/src-tauri/src/system_tray.rs`(新)| `build_tray(app)` 注册图标 + 菜单项("打开 DeskFox" / "状态" / "暂停飞书桥接" / "退出 DeskFox")+ 状态切换 API |
| `packages/desktop/src-tauri/src/lib.rs` | setup() 加 `system_tray::build_tray(app)?` + RunEvent 拦截 CloseRequested → `prevent_close()` + `window.hide()` |
| `packages/branding/src/assets/tray-icons/`(新)| 4 个状态图标 PNG(默认/已连/离线/错误,template 模板模式) |
| `packages/desktop/src-tauri/tauri.conf.json` | 不动(LSUIElement v1 决策不开,保 dock 图标) |
| `packages/desktop/src-tauri/src/__tests__/system_tray.rs`(新)| 单测(图标 path / 菜单项构造) |

### commit 拆分

| # | 主题 | 文件 |
|---|---|---|
| C0.5.1 | feat(desktop): system tray scaffold + 4 state icons | system_tray.rs + tray-icons/ |
| C0.5.2 | feat(desktop): close GUI ≠ exit main process | lib.rs CloseRequested 拦截 |
| C0.5.3 | feat(desktop): tray menu items + status indicator API | system_tray.rs 菜单 + Tauri command |

### 验收标准

- [ ] mac:启动 DeskFox 顶部菜单栏出 🦊 图标
- [ ] mac:Cmd-Q / 关窗口按钮 → 主窗口隐藏,主进程仍跑(`ps aux | grep DeskFox` 仍在)
- [ ] mac:点 tray 菜单 "打开 DeskFox" → 主窗口重 show
- [ ] mac:点 tray 菜单 "退出 DeskFox" → 真退出
- [ ] Win:右下任务栏出图标 + 同上行为(Win 单击图标直接打开主窗口)
- [ ] 状态切换 API:Tauri command `set_tray_status(state)` 切换图标变体(此时还没 adapter,先用 mock 调用验证)
- [ ] 单测 system_tray 模块基础

---

## Phase 1:OAuth Device Flow + DeskFox GUI 弹窗 + i18n(1.5 天)

### 目标

end-to-end 跑通**扫码绑定主用户**:GUI 点按钮 → 弹二维码 → 飞书 App 扫 → 拿到凭证 → 写加密配置。**只此一项**,长连接 / 消息收发留 Phase 2。

### 改动文件

| 文件 | 改动 |
|---|---|
| `packages/adapter-feishu-lark/src/feishu/oauth.ts`(新)| `init() / begin() / poll()` 三步骤 + 域名分组(feishu/lark)+ 错误处理 |
| `packages/adapter-feishu-lark/src/feishu/__tests__/oauth.test.ts`(新)| 单测覆盖 3 step + 错误码 + 域名切换 |
| `packages/adapter-feishu-lark/src/server.ts`(新)| 起 localhost HTTP server(随机端口),暴露 `/oauth/begin` + `/oauth/poll/:deviceCode` |
| `packages/desktop/src-tauri/src/feishu_adapter.rs`(新)| spawn adapter sidecar + 取 ServerReadyData(adapter port + auth token) |
| `packages/desktop/src-tauri/src/lib.rs` | setup() 加 `feishu_adapter::spawn(app)`(暂时同 opencode-cli 模式) |
| `packages/app/src/components/settings-feishu.tsx`(新)| Settings 飞书桥接 Tab(暂只"账户"子 Tab) |
| `packages/app/src/components/feishu-bind-dialog.tsx`(新)| 扫码弹窗组件(二维码 + user_code + 倒计时 + 状态) |
| `packages/app/src/utils/feishu-config.ts`(新)| GUI 端配置读写 wrapper(调主进程 invoke) |
| `packages/app/src/i18n/{zh,zht,en}.ts` | 加 `settings.feishu.*` / `feishu.bind.*` 等 ~20 个 key × 3 dict |

### commit 拆分

| # | 主题 | 文件 |
|---|---|---|
| C1.1 | feat(adapter-feishu-lark): OAuth Device Flow 三步骤 + 单测 | feishu/oauth + 测试 |
| C1.2 | feat(adapter-feishu-lark): localhost HTTP server + /oauth/* endpoints | server.ts |
| C1.3 | feat(desktop): adapter sidecar spawn + ServerReadyData | feishu_adapter.rs + lib.rs |
| C1.4 | feat(app): Settings 飞书桥接 Tab + i18n 三本字典 | settings-feishu + i18n |
| C1.5 | feat(app): 扫码弹窗组件 + 状态轮询 | feishu-bind-dialog + utils/feishu-config |

### 验收标准

- [ ] DeskFox 启动:adapter sidecar spawn(`ps aux \| grep adapter-feishu`)
- [ ] Settings → 飞书桥接 → "添加飞书账号" → 弹窗显示二维码 + user_code 大字 + 60 分钟倒计时
- [ ] 用真飞书 App 扫码 → 5 秒内 GUI 状态变 "✅ 已绑定"
- [ ] `~/.opencode/feishu-config.json` 写出来,`appSecret` 是 SecretRef(file 模式默认)
- [ ] OAuth 单测 ≥ 80% 行覆盖
- [ ] 扫码弹窗 e2e 1 happy path(mock OAuth 模式)

---

## Phase 2:长连接 + 6 类事件 + 节流 + chatQueue + dedup(2 天)

### 目标

绑定后 adapter **自动启动 WSS 长连接**,接 6 类事件,**消息 → opencode prompt_async → SSE 流式回写飞书**全链路打通。MVP 第二大块。

### 改动文件

| 文件 | 改动 |
|---|---|
| `packages/adapter-feishu-lark/src/feishu/wss-client.ts`(新)| `@larksuiteoapi/node-sdk WSClient` 包装 + 重连 + heartbeat |
| `packages/adapter-feishu-lark/src/feishu/event-handlers.ts`(新)| 6 类事件入口(消息 / 表情 / 加退群 / 视频会议 / 文档评论 / 卡片点击) |
| `packages/adapter-feishu-lark/src/feishu/throttle.ts`(新)| FlushController 互斥锁 + CardKit/Patch 双路径节流(100ms/1500ms)+ long-gap 后批量 |
| `packages/adapter-feishu-lark/src/feishu/chat-queue.ts`(新)| 同会话 Map<key, Promise> 串行(参考 OpenClaw 68 行) |
| `packages/adapter-feishu-lark/src/feishu/dedup.ts`(新)| msgId+ts Map TTL 12h / 5000 entries |
| `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts`(新)| 入口:消息 → dedup 检查 → chatQueue 串行 → opencode prompt_async → SSE 节流回写 |
| 单测 5 个新文件 | throttle / chat-queue / dedup / wss-client mock / event-handlers / message-pipeline |

### commit 拆分

| # | 主题 |
|---|---|
| C2.1 | feat(adapter-feishu-lark): WSS client 长连接 + 重连 |
| C2.2 | feat(adapter-feishu-lark): 6 类事件入口 |
| C2.3 | feat(adapter-feishu-lark): FlushController + CardKit/Patch 双路径节流 + 单测 |
| C2.4 | feat(adapter-feishu-lark): chatQueue 同会话串行 + 单测 |
| C2.5 | feat(adapter-feishu-lark): dedup TTL Map + 单测 |
| C2.6 | feat(adapter-feishu-lark): message-pipeline 端到端贯通 |

### 验收标准

- [ ] 绑定后 adapter 自动连 WSS,日志 "WSS connected"
- [ ] 私聊 DeskFox bot "你好" → 5 秒内飞书消息流式更新出 LLM 回答
- [ ] 群里 @bot "你好" → 同上
- [ ] 连发 3 条消息:严格按顺序响应,不并发(chatQueue 串行验证)
- [ ] 长连接断 → 自动重连(模拟网络断 60s 后 ✅)
- [ ] dedup:重连后飞书重放消息 → 不重复响应
- [ ] 节流模块 / chatQueue / dedup 单测 ≥ 80%

---

## Phase 3:permission + 副用户 + GUI 已绑定列表 + 健康检查(1.5 天)

### 目标

加上"安全审批"(危险命令需 user 同意)+ 副用户加入流程 + GUI 状态 view。

### 改动文件

| 文件 | 改动 |
|---|---|
| `packages/adapter-feishu-lark/src/feishu/permission-card.ts`(新)| opencode SSE `permission.requested` → 飞书 form 卡片(approve/deny)→ 回写 opencode |
| `packages/adapter-feishu-lark/src/feishu/secondary-user.ts`(新)| 6 位绑定码生成(36^6 + 5 分钟 TTL + 限流)+ 加入流程 |
| `packages/app/src/components/settings-feishu/accounts-tab.tsx`(新)| 已绑定主用户列表 + 副用户列表 + 添加/删除按钮 |
| `packages/app/src/components/settings-feishu/health-tab.tsx`(新)| WSS 状态 / 最近错误 / 重连按钮 |
| `packages/app/src/components/feishu-secondary-bind-dialog.tsx`(新)| 副用户 6 位码弹窗 |
| 单测 / e2e | permission / secondary-user |

### commit 拆分

| # | 主题 |
|---|---|
| C3.1 | feat(adapter-feishu-lark): permission ask 卡片(approve/deny)+ 单测 |
| C3.2 | feat(adapter-feishu-lark): 副用户 6 位绑定码 + 限流 + 单测 |
| C3.3 | feat(app): 账户 / 健康检查 双子 Tab + 副用户弹窗 |

### 验收标准

- [ ] DeskFox 用 bash 执行命令 → 飞书弹卡片 "需要授权:bash xxx" + 同意/拒绝按钮
- [ ] 点同意 → 命令真执行 + 结果回写
- [ ] 点拒绝 → opencode 收到拒绝 + LLM 输出 "授权被拒绝"
- [ ] 主用户 GUI 添加副用户 → 显示 6 位码 → 朋友加 bot + 发码 → ✅
- [ ] 健康检查 Tab 显示 WSS 已连 / 离线 / 错误状态
- [ ] permission / secondary-user 单测 ≥ 80%

---

## Phase 4:好用版增量 A — CardPhase / Abort / coalesce / table 降级 / AppOwnership / Unavailable(2.5 天)

### 目标

把 MVP 体验补齐:取消快、流式平滑、卡片防 ghost update、表格降级、应用归属校验。**6 项一组**因为都是消息处理路径上的细节。

### 改动文件

| 文件 | 改动 |
|---|---|
| `packages/adapter-feishu-lark/src/feishu/card-phase.ts`(新)| `pending → streaming → done\|aborted\|error` 状态机 + PHASE_TRANSITIONS 校验 |
| `packages/adapter-feishu-lark/src/feishu/abort.ts`(新)| Abort fast-path:消息进 chatQueue 前扫"取消/abort/停" → `abortController.abort()` + `abortCard()` |
| `packages/adapter-feishu-lark/src/feishu/coalesce.ts`(新)| Block streaming coalesce(短间隔多 token < 50ms 聚合) |
| `packages/adapter-feishu-lark/src/feishu/markdown-degrade.ts`(新)| markdown.tables 三档降级(off/bullets/code)|
| `packages/adapter-feishu-lark/src/feishu/app-ownership.ts`(新)| 每条消息检 `app_id` + `event_time` < 5 分钟 |
| `packages/adapter-feishu-lark/src/feishu/unavailable-guard.ts`(新)| 编辑卡片 404 → 标 unavailable + 停后续编辑 |
| `message-pipeline.ts` | 改:接入 6 个新模块 |
| 单测 6 个新文件 | 全 |

### commit 拆分

| # | 主题 |
|---|---|
| C4.1 | feat(adapter-feishu-lark): CardPhase 状态机 + 单测 |
| C4.2 | feat(adapter-feishu-lark): Abort fast-path + 单测 |
| C4.3 | feat(adapter-feishu-lark): Block streaming coalesce + 单测 |
| C4.4 | feat(adapter-feishu-lark): markdown.tables 三档降级 + 单测 |
| C4.5 | feat(adapter-feishu-lark): AppOwnership + isMessageExpired + 单测 |
| C4.6 | feat(adapter-feishu-lark): UnavailableGuard 404 防 + 单测 |

### 验收标准

- [ ] 飞书发"取消" → 当前正在跑的卡片 500ms 内变 "已取消" 灰色
- [ ] LLM 流式输出短 token 不闪烁(肉眼对比 vs Phase 2 末尾)
- [ ] markdown 表格自动降级显示(测 off/bullets/code 3 档)
- [ ] 异企业的飞书消息错误送达 → 丢弃(不响应)
- [ ] user 撤回卡片 → 后续编辑不报错
- [ ] 6 个模块单测 ≥ 80%

---

## Phase 5:多账号 + 群级独立配置 + threadSession 线程隔离(1.5 天)

### 目标

支持挂多家飞书企业 + 同企业不同群独立 system prompt/tools/skills + 群里多人讨论时线程隔离 session。

### 改动文件

| 文件 | 改动 |
|---|---|
| `packages/adapter-feishu-lark/src/core/config-schema.ts` | 改:加 `accounts: { [accountId]: ... }` + `groups: { [chatId]: { systemPrompt, tools[], skills[] } }` + `threadSession: bool` |
| `packages/adapter-feishu-lark/src/feishu/account-router.ts`(新)| 消息按 `app_id` 分发到对应 account 的 message-pipeline |
| `packages/adapter-feishu-lark/src/feishu/group-config.ts`(新)| 取群级配置 merge 到 prompt_async 调用 |
| `packages/adapter-feishu-lark/src/feishu/thread-session.ts`(新)| 飞书 message thread → opencode session 1:1 映射 + LRU 1000 |
| `packages/app/src/components/settings-feishu/groups-tab.tsx`(新)| 群级配置 GUI(per-chat 输入 prompt + 工具白名单)|
| 单测 4 个新文件 | 全 |

### commit 拆分

| # | 主题 |
|---|---|
| C5.1 | feat(adapter-feishu-lark): 多账号 schema + account-router + 单测 |
| C5.2 | feat(adapter-feishu-lark): 群级独立配置 + group-config merge + 单测 |
| C5.3 | feat(adapter-feishu-lark): threadSession 线程隔离 + LRU 单测 |
| C5.4 | feat(app): 群级配置 GUI Tab |

### 验收标准

- [ ] 配置 `accounts: { "company-a": {...}, "company-b": {...} }` 后:两家企业同时收到消息,各自独立 chatQueue
- [ ] 同企业 群 A 配 "直白回答" prompt / 群 B 配 "正式风格" → 两群行为不同
- [ ] 群里 user1 + user2 同时找 bot → 各自独立 session(测互不串上下文)
- [ ] 群级配置 GUI 编辑 → 保存 → 立即生效
- [ ] 4 模块单测 ≥ 80%

---

## Phase 6:AskUserQuestion + heartbeat(2 天)

### 目标

DeskFox 主动反问 + 主动定时消息 — 好用版"对标 OpenClaw"的最大体验提升点。

### 改动文件

| 文件 | 改动 |
|---|---|
| `packages/adapter-feishu-lark/src/feishu/ask-user-question.ts`(新)| 实现 AskUserQuestion 工具:立即返回 pending(synthetic message 注入)+ 飞书 form 卡片(最多 4 选项)+ 答案塞回 agent loop |
| `packages/adapter-feishu-lark/src/feishu/by-chat-context.ts`(新)| 二级索引(chatId, byContext) → questionId,歧义时拒绝 |
| `packages/adapter-feishu-lark/src/feishu/heartbeat.ts`(新)| cron(`node-cron` 或 `croner`)+ activeHours 解析 + 主动消息发送 |
| `packages/adapter-feishu-lark/src/core/config-schema.ts` | 加 `heartbeat: { enabled, schedule, activeHours, message }` |
| `packages/app/src/components/settings-feishu/heartbeat-tab.tsx`(新,可选)| heartbeat GUI 配置(可放 groups-tab 内) |
| 单测 3 个新文件 | 全 |

### commit 拆分

| # | 主题 |
|---|---|
| C6.1 | feat(adapter-feishu-lark): AskUserQuestion 工具 + form 卡片 + 单测 |
| C6.2 | feat(adapter-feishu-lark): byChatContext 二级索引 + 拒绝歧义 + 单测 |
| C6.3 | feat(adapter-feishu-lark): heartbeat cron + activeHours + 单测 |
| C6.4 | feat(app): heartbeat GUI 配置 |

### 验收标准

- [ ] DeskFox 处理用户请求时调 AskUserQuestion → 飞书出现含 4 选项的 form 卡片
- [ ] user 点选项 → DeskFox agent 收到答案继续干
- [ ] 同时 2 个 chat 都有 AskUserQuestion 待答 → 各自不串号
- [ ] 配置 `heartbeat: { schedule: '0 9 * * 1-5', activeHours: '9-18', message: '早上好' }` → 工作日 9 点收到主动消息
- [ ] 周末或 9-18 外不发 heartbeat
- [ ] 3 模块单测 ≥ 80%

---

## Phase 7:R5 测试收尾 + GUI e2e + 三文档(1 天)

### 目标

补齐前 6 个 Phase 中可能漏掉的覆盖率 + GUI e2e + 写完 3-changelog.md + 更新 INDEX + 改动日志。

### 改动

- **覆盖率扫一遍**:Logic 清单(spec §8.1)13 个文件全跑 `bun test --coverage`,< 80% 的补测
- **GUI e2e**(Playwright,backlog `e2e-mock-infrastructure` 提供基础设施)
  - `e2e/feishu-bind.spec.ts`:扫码绑定 happy path(mock OAuth 模式)
  - `e2e/feishu-tray.spec.ts`:system tray 行为(关 GUI / 重 show / 退出)
- **3-changelog.md**:commit hash 列表 + 行数 + 影响范围 + 回归测试 + 回退方法
- **`docs/features/INDEX.md`**:加索引行
- **`改动日志.md`**:加索引行

### commit 拆分

| # | 主题 |
|---|---|
| C7.1 | test(adapter-feishu-lark): 补漏覆盖率到 ≥ 80% |
| C7.2 | test(app): feishu GUI e2e(扫码 + tray) |
| C7.3 | docs(feishu-bridge): 3-changelog + INDEX + 改动日志 |

### 验收标准

- [ ] Logic 清单全部 ≥ 80%(15+ 模块)
- [ ] View 清单 ≥ 1 e2e happy path
- [ ] 三文档完整链路(spec / plan / changelog)
- [ ] INDEX + 改动日志同步
- [ ] feat 分支可合 dev(等 user 拍板)

---

## 总 commit 估算

按上面 Phase 拆,~26 笔 commit:

| Phase | commits | 净行数 | 其中测试 |
|---|---|---|---|
| 0 | 4 | ~400 | ~150(40%) |
| 0.5 | 3 | ~300 | ~50(17%) |
| 1 | 5 | ~600 | ~200(33%) |
| 2 | 6 | ~700 | ~250(36%) |
| 3 | 3 | ~400 | ~150(38%) |
| 4 | 6 | ~600 | ~250(42%) |
| 5 | 4 | ~400 | ~150(38%) |
| 6 | 4 | ~400 | ~150(38%) |
| 7 | 3 | ~150 | ~150(100%) |
| **合计** | **26** | **~3950** | **~1500(38%)** |

满足 R5 70/20/10 金字塔(unit 70%~~+ integration 20% + e2e 10%);整体测试占比 38% 接近行业健康基线。

---

## 99. 决策轨迹(实施中实时追加 note)

> 此段是 plan 的"开发日记",每遇到 spec 没预测到的踩坑 / 推翻方案 / 工程量重估 → 加一条 note。**plan 锁版只补不改**(spec 也是同规则)。

### 2026-05-08 锁版

- spec v2 + plan v1 同日锁定。 user 2026-05-08 全部 5 决策点签字。
- Phase 0.5 是 v2 新加(原 spec v1 没有 system tray),工程量从 13.5 天 → 14.5 天。
- 当前分支:`feat/feishu-bridge`(本仓 origin/dev = `6be6ea4b1` 起)
- 上次 ship:`ship-mac-prod-2026.5.7.1` tag 还在远端但 0 release(CI baseline 下载坑后已修);**本 feat 不依赖 ship**。

(后续 note 实施中追加)
