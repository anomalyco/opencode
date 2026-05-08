---
feat-id: feishu-bridge
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-bridge — 1-spec(好用版,v2 锁版)

> **状态**:✅ user 锁版(2026-05-08,5 决策点全锁,工程量 14.5 天)
> **档位决策(2026-05-08 user 拍板)**:直接做**好用版**(跳过 MVP 单独 ship)
> **架构核心(v2 修订)**:**monorepo workspace** + **DeskFox 主进程常驻 system tray + sidecar 内嵌 adapter** — 装 DeskFox 即得飞书,关 GUI 后台仍跑
> **来源**:[OPENCODE-PLAN 需求池 v3 锁版](file:///Volumes/ExtSSD/OPENCODE-PLAN/需求池/飞书桥接-扫码绑定.md)(687 行,2026-05-07)+ [飞书 OAuth Device Flow 实测调研](file:///Volumes/ExtSSD/OPENCODE-PLAN/archive/调研产物/飞书OAuth-2026-05-07/)
> **父需求**:[im-桥接服务器.md](file:///Volumes/ExtSSD/OPENCODE-PLAN/需求池/im-桥接服务器.md) 多平台 IM 总览;本 feat 聚焦飞书专项

---

## 1. 触发原因

DeskFox 当前只能在本机跑(打开 .md / 用 chat / 编辑文档),user 远程时(出门 / 在飞书里办公)无法触发本机能力。希望:

> **场景**:user 在飞书里发一句话给 DeskFox 机器人 → DeskFox 在 user 的电脑上干活(读文件 / 跑命令 / 调本地 LLM)→ 流式把结果发回飞书。

实测验证(2026-05-07):飞书已开放 OAuth Device Flow 标准接口(RFC 8628),**无需任何鉴权**,扫码即创建应用 + 颁发凭证 + 绑定主用户。**机制成立可行**。

## 2. 需求 / 验收标准(好用版,共 19 项)

### 2.1 核心场景(MVP 子集 8 项,基础门槛)

| # | 需求 | 验收标准 |
|---|---|---|
| F1 | **OAuth 扫码绑定主用户** | DeskFox GUI 点"添加飞书账号"→ 弹窗显示二维码 + user_code 大字 + 60 分钟倒计时 → 用户飞书 App 扫码 → 同意授权 → DeskFox 拿到 `{appId, appSecret, openId}` 写加密配置 → 启动长连接;30 秒内完成 |
| F2 | **6 类事件长连接接收** | 飞书 App 发的"消息 / 表情 / 加退群 / 视频会议 / 文档评论 / 卡片点击"事件,DeskFox 都能接到 |
| F3 | **私聊消息 → opencode 转发** | user 私聊 DeskFox bot 一句话 → adapter 调 opencode `POST /:sessionID/prompt_async` → SSE 流式回 → 节流编辑回飞书消息卡片 |
| F4 | **群消息 @ 触发** | 群里 @DeskFox bot → 同 F3 流程 → 群消息回写;白名单外不响应 |
| F5 | **副用户 6 位绑定码** | 主用户 GUI 点"添加副用户"→ 生成 6 位码(5 分钟过期)→ 朋友加 bot 好友后发码 → adapter 验证 → openId 加白名单 |
| F6 | **permission ask 卡片** | DeskFox 要执行 bash/rm/edit → opencode SSE `permission.requested` → adapter 转飞书卡片(approve/deny 按钮)→ user 点同意 → 通过 `POST /permission/:permissionID` 回写 |
| F7 | **chatQueue 同会话串行** | 同一 user 连发 3 条消息 → adapter 队列串行执行(前一条完才跑下一条),不并发乱码 |
| F8 | **dedup 消息去重** | 长连接重连后飞书可能重放消息 → adapter `<msgId, ts>` Map TTL 12h / 5000 entries 去重,不重复响应 |

### 2.2 好用版增量(11 项)

| # | 需求 | 验收标准 |
|---|---|---|
| G1 | **CardPhase 显式状态机** | 卡片状态用 `pending → streaming → done \| aborted \| error` 状态机替代 boolean flag;状态切换用 PHASE_TRANSITIONS 校验,非法转移直接 throw |
| G2 | **Abort fast-path** | user 飞书发"取消"/"abort"/"停" → 不入 chatQueue 直接 `abortController.abort()` + `abortCard()` 标记当前卡片为 aborted;500ms 内可见 |
| G3 | **Block streaming coalesce** | LLM 短间隔多 token(<50ms)聚合一次推飞书,避免单字符更新导致卡片闪烁 |
| G4 | **markdown.tables 三档降级** | DeskFox 输出 markdown 表格 → 三档自动选(off / bullets / code),按 user config + 飞书卡片支持自动 |
| G5 | **AskUserQuestion 工具** | DeskFox agent 调 `AskUserQuestion(question, options[])` → adapter 立即返回 pending(synthetic message 注入)+ 飞书发 form 卡片(最多 4 选项)→ user 点选 → 答案塞回 agent loop |
| G6 | **byChatContext 二级索引** | AskUserQuestion 多个 chat 同时挂着歧义时,adapter 按 `chatContext` 二级索引绑定,不跨 chat 串号;无法定位时拒绝猜测 |
| G7 | **多账号支持** | `accounts: { "company-a": {...}, "company-b": {...} }` schema,1 个 DeskFox 同时挂多家飞书企业,消息按 appId 分发 |
| G8 | **群组级独立配置** | `groups: { "<chatId>": { systemPrompt, tools[], skills[] } }` 每个群可定制 agent 行为 |
| G9 | **App ownership 校验 + 防过期** | 每条消息检 `app_id` 跟绑定一致 + `event_time` 距今 < 5 分钟,否则丢弃,防误处理 |
| G10 | **UnavailableGuard** | 编辑卡片返回 404(用户撤回)→ 标记 unavailable + 停后续编辑,0 错误日志噪声 |
| G11 | **threadSession 线程隔离** | 同群多人同时找 DeskFox → 每个**飞书消息线程**独立 opencode session,上下文不混 |
| G12 | **heartbeat 主动消息** | cron(`0 9 * * 1-5`)+ activeHours(`9-18`)→ DeskFox 主动发"早上好,今天日程..."(可关) |

### 2.3 GUI 验收(DeskFox 端)

- Settings → "飞书桥接" Tab(中英 i18n)
- 三个子 Tab:**账户**(已绑定 / 添加 / 删除)/ **群组配置**(per-chat)/ **健康检查**(连接状态 / 最近错误)
- 启动 toggle:"DeskFox 启动时自动启用飞书桥接"(默认 on)

### 2.4 GUI 常驻 + system tray UX(v2 新增)

> 核心需求:user 关闭 DeskFox 主窗口后,飞书桥接**仍在后台跑**,飞书消息仍能送达。整体体验类似微信 / Slack:关窗口 ≠ 退出程序。

| # | 需求 | 验收标准 |
|---|---|---|
| T1 | **system tray 图标常驻** | mac:顶部菜单栏右侧 🦊 模板图标(随暗黑模式黑/白自适应);Win:右下任务栏通知区图标;Linux:libappindicator |
| T2 | **关 GUI ≠ 退出主进程** | 点关闭按钮 / Cmd-Q 改成 hide window;主进程保留;mac dock 图标可隐藏(LSUIElement / `[NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory]`)/ Win 不显任务栏 |
| T3 | **图标右键菜单** | "打开 DeskFox" / "飞书桥接状态:✅ 已连接 / ⚠️ 离线 / 🔴 错误" / "暂停飞书桥接" / "退出 DeskFox" |
| T4 | **图标点击行为** | mac 单击:显示菜单(macOS 惯例);Win 单击:打开主窗口;mac 双击图标 / Win 右键 "打开 DeskFox":弹主窗口 |
| T5 | **状态指示** | 图标变体:默认 / 已连飞书(原色)/ 离线(灰)/ 错误(红);通过图标颜色区分 |
| T6 | **真退出路径** | 唯一退出途径:tray 菜单 "退出 DeskFox";绝不响应误关 |
| T7 | **首次启动提示** | mac:Cmd-Q 时弹气泡 "DeskFox 转后台运行,从顶部菜单栏 🦊 退出";Win 同理 toast |

## 3. 范围 / 不范围

### 3.1 全 scope 都在 fork monorepo 内(v2 修订:不再独立仓)

**关键架构决策(2026-05-08 user 拍板)**:adapter 不独立 GitHub 仓,**作为 fork 仓的 monorepo workspace**(`packages/adapter-feishu-lark/`)。理由:
1. 跟现有 monorepo 风格一致(`packages/app` / `packages/branding` / `packages/core` 等并列)
2. 单兵 + DeskFox 专用场景,无需跨仓维护
3. CI 一次跑通整个 build / typecheck / test
4. 类型 / 配置共享(adapter 直接 `import` opencode 类型,0 ts paths 配置)
5. 给 OpenClaw 等其他 host 用的诉求**当前不存在**(user 单兵 + DeskFox 单 host)

### 3.2 fork 仓改动一览(v2 修订:全在 fork 仓内)

✅ **新增 workspace** `packages/adapter-feishu-lark/`:
  - `src/core/` — 跨 IM 抽象(为以后钉钉/企微 / Slack 留接口)
  - `src/feishu/` — 飞书专属:OAuth Device Flow / WSS 长连接 / 节流 / chatQueue / dedup / permission / AskUserQuestion / heartbeat
  - `src/server.ts` — 启 localhost HTTP server,DeskFox GUI 调
  - `src/plugin.ts` — plugin slot 接口(D5 锁定:为以后 MCP / OpenClaw skill 复用预留)
  - `scripts/probe-feishu-oauth.ts` — 飞书接口探针(从 OPENCODE-PLAN/archive/调研产物 迁过来,CI 周跑)
  - `package.json` — 名 `@opencode-ai/adapter-feishu-lark` 跟 fork 仓现有命名一致

✅ **DeskFox GUI 端**(`packages/app/src/`):
  - Settings 飞书桥接面板 + 三子 Tab(账户 / 群组配置 / 健康检查)
  - OAuth 扫码弹窗(二维码 + user_code 大字 + 倒计时 + 状态轮询)
  - i18n 中英三本字典 key

✅ **Tauri 主进程**(`packages/desktop/src-tauri/src/`):
  - **system tray + GUI 关不退主进程**(v2 新增,§4.1 详)
  - adapter 进程管理(spawn / kill / restart / health check)— Tauri sidecar 机制
  - 主进程命令:`get_feishu_status` / `restart_feishu_adapter` / 等

✅ **build 集成**(`packages/branding/scripts/`):
  - build-deskfox.sh / .ps1 — adapter binary 内嵌进 `.app/.exe`(类似现有 sidecar 机制)
  - tauri.conf.json 加 adapter 到 sidecars 配置

✅ **测试**(R5 双清单):
  - Logic 清单:`adapter-feishu-lark` 核心模块 ≥ 80% / `feishu-config` 配置 schema / `adapter-process-manager` 进程管理
  - View 清单:Settings 飞书桥接面板 e2e 1 happy path / OAuth 扫码弹窗 e2e

### 3.3 不做(明确排除)

- ❌ **不做 Webhook 模式**:已锁定长连接(WSS),webhook 需要公网 + ngrok,桌面端不适用
- ❌ **不做 archetype 切换**:死锁定 `PersonalAgent`,其他类型(`OrgApp`)是企业部署场景
- ❌ **不做 SaaS 网页 OAuth**:本机桌面只走 Device Flow
- ❌ **不做飞书机器人主动加用户**:飞书无此 API
- ❌ **不做自动检测 feishu.cn / lark.com 域**:让 user GUI 显式选(企业知道自己用哪个)
- ❌ **不在 fork 仓内置 9 个飞书业务 skill**(create-doc/calendar 等):走 MCP server 路径(2026-2027 生态成熟时切),adapter 不重写
- ❌ **不做 universal binary**:Mac arm64 only(同 DeskFox 主程序策略)

## 4. 架构选型(关键决策,v2 全锁定)

### 4.1 启动模式 — **system tray 常驻 + sidecar 内嵌**(v2 锁定)

> v1 草稿是 "C 混合 toggle on/off",v2 user 反馈"GUI 关后服务要常驻 + 装即用"后,改成更直接的方案。

```
DeskFox.app 启动
  ↓
Tauri 主进程 init
  ↓
spawn opencode-cli sidecar(已有)
  ↓
spawn adapter-feishu-lark sidecar(v2 新)
  ↓
注册 system tray 图标(macOS menu bar / Win 任务栏 / Linux indicator)
  ↓
显示主窗口(GUI)
                                          ┌──────────────────────────┐
关闭主窗口                                  │  user 用 mac:Cmd-Q       │
  → 改成 hide window(主进程不退)          │  → 主进程拦截改 hide      │
                                          │  → tray 图标常驻         │
adapter sidecar 跟主进程同生命周期常驻       │  → 飞书消息后台仍处理     │
  → 飞书消息进 adapter → opencode → 流式回 │                          │
                                          │  user 真退出:           │
真退出唯一路径:                            │  tray 图标 → "退出 DeskFox" │
  tray 菜单 → "退出 DeskFox"                └──────────────────────────┘
  → Tauri::App::exit()
  → 主进程退 → sidecar 跟着退(进程组)
```

**优点**:
1. user 装 DeskFox 即得飞书,**0 额外步骤**
2. 关 GUI 后台仍跑(像微信 / Slack 体验)
3. tray 图标显示状态,user 一眼看到"飞书是否连着"
4. 真退路径唯一明确(tray 菜单),防误关

**实现要点**(Tauri 2 原生 API):
- `tauri::tray::TrayIconBuilder` — 跨平台 system tray
- `RunEvent::WindowEvent { event: CloseRequested, .. }` 拦截 → `api.prevent_close()` + `window.hide()`
- macOS LSUIElement 处理:**不**设 LSUIElement(否则没 dock 图标关 GUI 后无法重开主窗口);改成主窗口关闭时 hide,tray 菜单"打开 DeskFox"重 show
- 状态指示:Tauri tray 支持运行时换图标,通过 IPC 监听 adapter health → 切图标

### 4.2 仓形态 — **monorepo workspace `packages/adapter-feishu-lark/`**(v2 锁定)

```
opencode-fork/  (本仓)
├── packages/
│   ├── app/                    (DeskFox GUI,已有)
│   ├── branding/               (品牌 + 打包脚本,已有)
│   ├── core/                   (共享 utils,已有)
│   ├── desktop/                (Tauri 桌面端,已有)
│   ├── opencode/               (opencode-cli sidecar,已有)
│   ├── ui/                     (UI 组件库,已有)
│   ├── adapter-feishu-lark/    ← v2 新增
│   │   ├── src/
│   │   │   ├── core/           (跨 IM 抽象,留以后扩展接口)
│   │   │   ├── feishu/         (飞书专属:OAuth/WSS/...)
│   │   │   ├── server.ts       (localhost HTTP server)
│   │   │   └── plugin.ts       (D5 plugin slot 接口)
│   │   ├── scripts/
│   │   │   └── probe-feishu-oauth.ts  (CI 周跑)
│   │   ├── package.json        (@opencode-ai/adapter-feishu-lark workspace 名)
│   │   └── tsconfig.json       (extends 仓根 tsconfig)
│   └── ...
└── ...
```

**好处**(对比独立仓):
- 跟 fork 仓 monorepo 风格一致(已有 7 个 workspace)
- bun workspace 自动 hoist 共享 deps
- typecheck 一次跑通整个仓
- CI 不需要双 release sync
- adapter 调 opencode types 直接 `import { ... } from "@opencode-ai/core"`

### 4.3 通信链路

```
飞书云端
  │
  └─ WSS 长连接 ─→ adapter sidecar(packages/adapter-feishu-lark)
                      ├─ HTTP ─→ opencode-cli sidecar(已有,跑 agent loop)
                      └─ HTTP ─→ DeskFox GUI(Tauri webview,通过 invoke 拿状态)
```

- adapter ↔ opencode:HTTP `localhost:<opencode_port>`(opencode 已有 serve API,sidecar credential 共享)
- adapter ↔ GUI:adapter 起 `localhost:<adapter_port>` HTTP server,GUI 通过 Tauri `invoke("get_feishu_status")` 让主进程代理 HTTP(避免 webview 直接出网)
- 主进程 ↔ adapter:Tauri sidecar `CommandEvent::{Stdout,Stderr,Terminated}` 监听 + ServerReadyData(同 opencode-cli 模式)

### 4.4 配置存储 — **SecretRef 三档**(借鉴 OpenClaw)

```
~/.opencode/feishu-config.json             ← 主配置(JSON,可读)
  channels.feishu.appSecret = SecretRef    ← 三档:
                                              - plaintext(Win 默认,Win 用户多)
                                              - env(高级 user)
                                              - file(macOS/Linux 默认,~/.opencode/feishu-secrets/<appId>.key,0600)
```

### 4.5 plugin slot(D5 锁定)

`packages/adapter-feishu-lark/src/plugin.ts` 定义 plugin 接口:

```typescript
export interface FeishuPlugin {
  id: string         // 'mcp-feishu-doc' / 'openclaw-feishu-calendar' / ...
  tools?: Tool[]     // 注入到 agent loop 的工具
  hooks?: { ... }    // 消息前 / 后 hooks
}

export function registerPlugin(plugin: FeishuPlugin): void
```

**v1 不内置任何 plugin**(只飞书 IM 桥接核心)。以后:
- 加 MCP server adapter(中期生态成熟)→ 1 个 plugin
- 抄 OpenClaw 9 skill → 9 个 plugin
- user 自定义业务工具 → N 个 plugin

**0 重写 adapter 即可扩展**。

## 5. 工程量预估(14.5 工作日,8 个 Phase,v2 修订)

详细 Phase 拆分见 [2-plan.md](./2-plan.md)(spec 锁版后写)。这里给概览:

| Phase | 内容 | 工作量 |
|---|---|---|
| 0 | adapter monorepo workspace 起 + adapter-core 抽象 + opencode HTTP client + SecretRef 三档 | 1.5 天 |
| **0.5** | **DeskFox 主进程 system tray + GUI 关不退主进程 + 状态指示**(v2 新增) | **1 天** |
| 1 | OAuth Device Flow + DeskFox GUI 弹窗 + i18n 三本字典 | 1.5 天 |
| 2 | 长连接 + 6 类事件 + 节流(CardKit/Patch 双路径)+ chatQueue + dedup | 2 天 |
| 3 | permission ask 卡片 + 副用户 6 位绑定码 + GUI 已绑定列表 + 健康检查 | 1.5 天 |
| 4 | 好用版增量 A:CardPhase 状态机 / Abort fast-path / coalesce / table 降级 / AppOwnership / UnavailableGuard | 2.5 天 |
| 5 | 多账号支持 + 群级独立配置 + threadSession 线程隔离 | 1.5 天 |
| 6 | AskUserQuestion(form 卡片 + synthetic message + byChatContext)+ heartbeat 主动消息 | 2 天 |
| 7 | R5 关键模块覆盖率 ≥ 80% + GUI e2e + 三文档收尾 | 1 天 |
| **合计** | | **14.5 天**(0.5 天 buffer) |

## 6. 主程序启动面影响(v2 修订)

> v2 设计:adapter 总是跟主进程共生命周期(常驻 system tray 模式),没有 toggle off"完全 0 影响"路径。但有"暂停飞书桥接"开关 — adapter sidecar 仍在但不连飞书 WSS。

| 维度 | 数字(飞书已绑定后) | 数字(未绑定 / 已暂停) |
|---|---|---|
| 启动时间增量 | +1-2 秒(spawn 0.3s + WSS 握手 0.5-1s + Node cold start 0.5s) | +0.3 秒(spawn adapter 但不连 WSS) |
| `DeskFox.app` 大小增量 | +20-30 MB(`@larksuiteoapi/node-sdk` ~10MB + Node runtime ~10MB + adapter 代码 ~3MB) | 同 |
| 内存增量(adapter 常驻) | +60-100 MB | +40-60 MB(WSS 不连占用少) |
| CPU 增量 | 空闲 ~0.1% / 高峰 ~3-5% | ~0% |
| 磁盘 I/O | 启动 1 次读 1KB 凭证 + 复用 opencode SQLite | 启动 1 次读配置 |

**system tray 常驻额外成本**:
- 主进程 GUI 关闭后内存仍占 ~80 MB(Tauri 主 + opencode-cli + adapter-feishu-lark 三 sidecar)
- macOS dock 图标:不开 LSUIElement → dock 仍显示;开 LSUIElement → dock 不显但用户找不到怎么开主窗口(用 tray 菜单"打开 DeskFox")。**v1 决策**:不开 LSUIElement(保 dock 图标),关 GUI 等同 hide,dock 还在。

**结论**:可接受。常驻 ~80MB 跟 Slack(~150MB)/ 微信(~200MB)同量级,且 user 可"暂停飞书"降到 ~60MB。

## 7. 风险评估

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | 飞书 `archetype: PersonalAgent` 接口变化(限流 / 弃用) | 中 | 高(绑定流程 break) | adapter 启动检 + probe CI 周跑 + fallback 走"自建应用"链路 |
| R2 | OAuth Device Flow user_code 钓鱼 | 低 | 中 | GUI 大字号显示 user_code + 飞书 App 已实现确认层 |
| R3 | 副用户绑定码暴力破解 | 极低 | 中 | 6 位字母数字(36^6 ≈ 21亿)+ 5 分钟过期 + 限流 |
| R4 | App Secret 本地泄漏 | 低 | 高 | SecretRef 三档(默认 file 0600 / mac Keychain 升级路径) |
| R5 | 长连接断连(笔记本休眠 / 切网) | 高 | 低(SDK 自动重连) | `@larksuiteoapi/node-sdk` 自带指数退避 + adapter 60s 阈值 → GUI 红 banner |
| R6 | 飞书 API 版本变化 | 中 | 中 | SDK 锁版本 + 启动打印当前 API 版本 + probe CI |
| R7 | adapter 进程意外 crash 不重启 | 中 | 中 | Tauri 主进程 watch + 自动 respawn(参考 backlog REQ-017) |
| R8 | AskUserQuestion 跨 chat 串号 | 低 | 高(答案串错) | byChatContext 二级索引 + 歧义时拒绝猜测 |
| R9 | 卡片更新限速 | 低 | 中 | CardKit 100ms / Patch 1500ms 双路径节流 + FlushController 互斥 |
| R10 | adapter 启动慢导致 GUI 等待 | 中 | 低 | spawn 异步,GUI 显示"启动中..."状态;失败 60s 后红 banner |
| R11 | **常驻 adapter 死了 user 不知道**(v2 新增) | 中 | 高 | tray 图标变红 + Win toast / mac notification 通知;Tauri 主进程 watch sidecar Terminated event 自动 respawn(参考 backlog REQ-017);连续 3 次 respawn 失败才停 |
| R12 | **user 误以为关 DeskFox 飞书也关**(v2 新增) | 中 | 中 | 首次关 GUI 时弹气泡"DeskFox 转后台,飞书桥接仍在跑;从 🦊 退出";后续不再提示 |
| R13 | **macOS LSUIElement 取舍**(v2 新增) | 低 | 中 | v1 决策不开 LSUIElement(保 dock 图标),user 找不到主窗口时双击 dock 即可;若 v2 开 LSUIElement 需配套 user 教育(只 tray 菜单"打开") |

## 8. 测试策略(R5 双清单,v2 修订)

### 8.1 Logic 清单(单测 ≥ 80%)
- 加入: `packages/adapter-feishu-lark/src/feishu/oauth.ts`(OAuth Device Flow 三步骤)
- 加入: `packages/adapter-feishu-lark/src/feishu/throttle.ts`(CardKit/Patch 双路径节流 + FlushController)
- 加入: `packages/adapter-feishu-lark/src/feishu/chat-queue.ts`(同会话串行)
- 加入: `packages/adapter-feishu-lark/src/feishu/dedup.ts`(消息去重 TTL)
- 加入: `packages/adapter-feishu-lark/src/feishu/abort.ts`(Abort fast-path)
- 加入: `packages/adapter-feishu-lark/src/core/secret-ref.ts`(三档凭证存储)
- 加入: `packages/adapter-feishu-lark/src/core/config-schema.ts`(配置 schema + zod)
- 加入: `packages/app/src/utils/feishu-config.ts`(GUI 端配置读写 wrapper)
- 加入: `packages/desktop/src-tauri/src/system_tray.rs`(v2 新增 tray 逻辑)

### 8.2 View 清单(e2e ≥ 1 happy path)
- 加入: `packages/app/src/components/settings-feishu.tsx`(Settings 飞书 Tab)
- 加入: `packages/app/src/components/feishu-bind-dialog.tsx`(扫码弹窗)
- 加入: `packages/app/src/components/feishu-bind-status.tsx`(健康检查 view)

### 8.3 e2e 验证
- mock OAuth Device Flow(adapter 内置 mock 模式)→ DeskFox GUI 全流程跑通(扫码 → 绑定 → 列表显示)
- mock 长连接 → 模拟飞书消息 → opencode 调用 → 飞书回写
- system tray e2e:打开 DeskFox → tray 出现 → 关 GUI → tray 仍在 → 点 tray "打开 DeskFox" → GUI 重 show
- (Tauri e2e 框架靠 backlog `e2e-mock-infrastructure` feat 提供基础设施)

### 8.4 探针 CI(probe-feishu-oauth)
- adapter workspace 内 `scripts/probe-feishu-oauth.ts` 实际调飞书接口验证响应字段
- GitHub Actions cron 每周一跑一次 → 失败发 issue / discord 通知
- R1 风险(`archetype: PersonalAgent` 弃用)的早期预警

## 9. 飞书业务功能扩展路径(对未来的回答)

### 9.1 短期(2026)
- adapter 不内置业务 skill(create-doc/calendar 等 9 个)
- 业务能力走 **opencode 内置工具**(read/write/bash 已有)→ DeskFox 在用户电脑干活,飞书业务用浏览器自动化或 user 手动操作
- 兜底:让 user 跑 OpenClaw + DeskFox 两个工具(短期割裂方案)

### 9.2 中期(2026-2027)
- **MCP(Model Context Protocol)生态成熟** → 飞书 / Lark 官方发 MCP server
- DeskFox 用户**复制 URL 粘到设置 → 全部飞书工具立刻可用**,adapter **0 重写**
- opencode 已内置 `opencode mcp` 命令,DeskFox GUI 加配置入口即可

### 9.3 远期(2027+)
- 任何 IM/SaaS 通过 MCP 接入,adapter 范式过时被 MCP 取代
- DeskFox 持续受益,无需架构调整

## 10. 锁版决策点(v2 全部锁定)

| # | 决策点 | 锁定方案 | 决议时间 |
|---|---|---|---|
| D1 | 档位 | **好用版**(MVP 8 项 + 好用版 11 项) | 2026-05-08 |
| D2 | 仓形态 | **monorepo workspace** `packages/adapter-feishu-lark/`(不独立仓) | 2026-05-08 |
| D3 | workspace 名 | `@opencode-ai/adapter-feishu-lark`(国内 + 国际双品牌一名涵盖,跟仓内现有命名一致) | 2026-05-08 |
| D4 | 启动模式 | **system tray 常驻 + sidecar 内嵌**(GUI 关后服务常驻,装即用) | 2026-05-08 |
| D5 | plugin slot | **是,预留接口**(v1 不内置 skill;以后 MCP / OpenClaw skill 复用) | 2026-05-08 |

---

## 11. v2 修订记录(2026-05-08)

跟 v1 草稿对比关键变化:

| 项 | v1 草稿 | v2 锁定 | 理由 |
|---|---|---|---|
| 仓形态 | 独立 GitHub 仓 + npm 发布 | monorepo workspace `packages/adapter-feishu-lark/` | user 单兵 + DeskFox 单 host,跨仓维护成本无意义 |
| 启动模式 | C 混合 toggle | sidecar 内嵌 + 主进程常驻 + system tray | user 要"装即用 + GUI 关后台仍跑"体验 |
| GUI 常驻 | 无(GUI 关 = 一切关) | system tray 常驻图标 + 关窗口 != 退出 | user 主动提需求 |
| 工程量 | 13.5 天 7 phase | 14.5 天 8 phase(+Phase 0.5 system tray) | 多 system tray 实现 |
| 启动面影响 | toggle off 时 0 影响 | 飞书已绑定时常驻 +80MB(无 0 路径) | 设计变化 |

---

**spec v2 锁定。等 user 最终签字 → 我出 [2-plan.md](./2-plan.md) 详细 Phase 拆分 → 实施。**
