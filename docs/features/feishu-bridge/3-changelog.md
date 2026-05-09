---
feat-id: feishu-bridge
status: done
related: ./1-spec.md ./2-plan.md ./architecture.md ./3-changelog.md
---

# feishu-bridge — changelog

> Phase 2 闭环已通过 user 实测验证(2026-05-09):飞书消息 → opencode → LLM → 回写飞书,multi-turn memory 在 sidecar lifetime 内保留;tray 常驻 / OAuth 扫码绑定 / per-account model / bot 名后台刷新 等全部功能已就绪。
>
> 本笔 changelog 总览本 feat 全周期 37 笔 commit(2026-05-08 → 2026-05-09)。

## 一句话

DeskFox 飞书桥接 — 用户在飞书 / Lark IM 发消息 → DeskFox 后台 sidecar(opencode plugin)收到 → 跑 LLM → 回写到飞书,user 不切窗就能跟 AI agent 对话。

## commit 列表(按 phase 分组,共 37 笔)

### Phase 0 — workspace + 共享模块(6 笔)

| commit | 简述 |
|---|---|
| `c70d0519e` | docs:1-spec v2 锁版 — 5 决策点全锁,好用版 14.5 天 |
| `c3ce6f6dd` | docs:2-plan 起草 — 8 Phase / 38 commits / 14.5 天 |
| `d8b39ca7c` | adapter-feishu-lark workspace setup + 4 deps(R4 override:bun.lock 自动重生,本 feat 范围内) |
| `425e1131a` | SecretRef 三档凭证存储 + 29 单测 |
| `751983a84` | config schema(zod)+ 27 单测 |
| `0a1eceb97` | opencode HTTP client(session/prompt/permission/SSE)+ 22 单测 |

### Phase 0.5 — System Tray(3 笔)

| commit | 简述 |
|---|---|
| `03a175f38` | system tray scaffold + 4 state icons(default/connected/offline/error) |
| `59457a5f1` | close GUI ≠ exit main process(关 GUI 不退主进程,后台常驻) |
| `6ea4dc14b` | tray menu(4 项)+ Tauri commands(set_tray_status / show_main_window / quit_app) |

### Phase 1 — OAuth Device Flow + 扫码绑定(7 笔)

| commit | 简述 |
|---|---|
| `f0ff34e51` | OAuth Device Flow 三步骤(init/begin/poll)+ 30 单测(RFC 8628 完整流程) |
| `79bb0338c` | adapter localhost HTTP server + /oauth/* endpoints + Basic auth + 19 单测 |
| `ba5d502a6` | 飞书 adapter Tauri commands(OAuth proxy)+ adapter spawn entrypoint |
| `a8a172994` | Settings 飞书桥接 Tab + i18n 三本字典(en/zh/zht 各 23 keys) |
| `851c9a6e7` | 飞书扫码绑定弹窗 + 状态轮询 + invoke wrapper |
| `18640d331` | Phase 1 实测闭环 — QR 渲染 + 自动 default domain + open_id 嵌套 bug 修复(R4 override:bun.lock + qrcode 依赖) |
| `a044eee38` | C1.6 OAuth 凭证写盘 + 已绑定列表 + agent=build 默认绑定 |

### Phase 2 — 纯逻辑模块(节流 / 串行 / 去重 / WSS)(4 笔)

| commit | 简述 |
|---|---|
| `1aae5fd15` | FlushController CardKit/Patch 双路径节流 + 14 单测 |
| `3576b39b2` | chatQueue 同会话串行 + 13 单测 |
| `16c4c5fc4` | DedupCache TTL Map(LRU 淘汰)+ 19 单测 |
| `0ba98bbc0` | C2.WSS — WSS 长连接 + im.message.receive_v1 事件入口 |

### Phase 2 闭环 + 架构改造(4 笔,关键)

| commit | 简述 |
|---|---|
| `b8d47df8d` | refactor:adapter 由独立 sidecar → opencode plugin(同 OpenClaw 架构)+ revert lib.rs |
| `ecd612a72` | plugin + server:chatSessionStore 接入 + onAccountsChanged hot reload + debug endpoints |
| `106a8a551` | fix:reply echo + archived 401 — 用 idle + setImmediate + session.messages 拉 reply |
| `08eeb8664` | chat-session-store — chatId → sessionID 持久化映射 + 16 单测 |

### UX 改进 + 综合(13 笔)

| commit | 简述 |
|---|---|
| `424bff753` | fix:二维码 race(setSecsLeft 必须在 setPhase 前) |
| `141189ec0` | per-account model 编辑 — Settings UI + Tauri commands + hot reload |
| `c60ecea85` | docs:architecture.md X1 plugin 自带 server + 多 IM 演进路径 |
| `016563129` | branding:tray icon fox silhouette 替换占位 |
| `9c8a22578` | branding:tray icon 加眼睛/嘴(evenodd 挖洞)+ 放大 |
| `d325509f5` | fix:settings 飞书桥接 tab 高度 — 加 h-full 撑满 Dialog |
| `b4756a7c4` | fix:settings 高度 + 切 tab 整屏闪 + adapter ready 检测 lazy-load |
| `e4175b832` | edit 弹窗 UX 优化 — 视觉层级 + 主次按钮 + 动态 hint |
| `c0f21bab5` | bot 名称数据通路 — saveAccount 拉 + 启动后台刷新(B 方案) |
| `b2d2f41c0` | bind 弹窗简化 — 删冗余文字 + 居中 + 成功自动关 |
| `e2989df9a` | edit 弹窗 — opencode 风格(form + size=large primary 左对齐)+ Select 视觉对齐(scoped CSS) |
| `7bb6d7102` | settings-feishu 综合改进 + i18n Lark Bridge 多语言(en/zht 改 Lark Bridge,zh 不动) |
| `39c731502` | 消息 ack — 收到立即给 user 消息加 OK reaction(同 OpenClaw 行为) |

## 改动文件(高层视角)

### 新建 fork-only

```
packages/adapter-feishu-lark/                        ← 新 monorepo workspace
  src/
    plugin.ts                                         ← opencode plugin entrypoint(模块级单例)
    server.ts                                         ← localhost HTTP server(OAuth + accounts CRUD + bot-info)
    core/
      config-schema.ts                                ← zod schema(account / group)
      secret-ref.ts                                   ← SecretRef 三档存储(file 0600 / keychain / env)
    feishu/
      oauth.ts                                        ← OAuth Device Flow 三步骤
      account-store.ts                                ← config.json 读写(saveAccount / list / delete / updateModel)
      message-pipeline.ts                             ← WSS event → opencode → 飞书 reply 主流程
      prompt-dispatcher.ts                            ← plugin event hook → waiter 路由
      chat-session-store.ts                           ← chatId → sessionID 持久化映射
      flush-controller.ts                             ← CardKit/Patch 节流
      chat-queue.ts                                   ← 同会话串行
      dedup-cache.ts                                  ← TTL/LRU 去重
      bot-info.ts                                     ← 拉飞书 bot 名(token + /open-apis/bot/v3/info)
      wss-client.ts                                   ← @larksuiteoapi WSClient 封装
      opencode-client.ts                              ← session/prompt/permission/SSE HTTP client
    __tests__/                                        ← 共 17 文件 + ~3000 行测试

packages/desktop/src-tauri/src/feishu_adapter.rs    ← Tauri commands proxy plugin server(saveAccount / list / delete / updateModel / listProviders / OAuth)
packages/desktop/src-tauri/src/system_tray.rs       ← Tauri tray icon + menu + lifecycle hooks
packages/branding/src/assets/tray-icons/             ← 4 状态 PNG + source SVG(fox template silhouette)

packages/app/src/components/feishu-bind-dialog.tsx     ← 扫码 dialog
packages/app/src/components/feishu-edit-account-dialog.tsx + .css  ← 编辑账号 model dialog(scoped CSS)
packages/app/src/components/settings-feishu.tsx        ← Settings 飞书桥接 tab
packages/app/src/utils/feishu-config.ts                ← Tauri command wrapper

docs/features/feishu-bridge/{1-spec,2-plan,3-changelog,architecture}.md
```

### 改上游(都加 FORK marker)

| 文件 | 改动概述 |
|---|---|
| `packages/desktop/src-tauri/src/lib.rs` | 注册 system_tray::* + feishu_adapter::* Tauri commands;close GUI 不退主进程 |
| `packages/desktop/src-tauri/Cargo.toml` | 加 reqwest / dirs / base64 等 deps(adapter HTTP + 文件路径 + auth header) |
| `packages/app/src/components/dialog-settings.tsx` | 加飞书桥接 tab + h-full 撑满 + defaultTab? prop(让 reshow 时定位飞书 tab) |
| `packages/app/src/i18n/{en,zh,zht}.ts` | feishu i18n keys 26 个(en→Lark Bridge / zht→Lark 橋接 / zh→飞书桥接) |
| `~/.config/opencode/opencode.json`(用户文件) | `plugin: ["file://...adapter-feishu-lark/src/plugin.ts"]`(运行时加载,非仓内改动) |

## 验证

### 测试覆盖

| 模块 | 测试方式 | 数量 | 状态 |
|---|---|---|---|
| SecretRef | unit | 29 | ✅ |
| config schema | unit | 27 | ✅ |
| opencode-client | unit | 22 | ✅ |
| OAuth Device Flow | unit | 30 | ✅ |
| HTTP server | unit | 19 | ✅ |
| FlushController | unit | 14 | ✅ |
| chatQueue | unit | 13 | ✅ |
| DedupCache | unit | 19 | ✅ |
| chat-session-store | unit | 16 | ✅ |
| **小计** | | **189 单测** | 全 pass |
| 飞书桥接 e2e | 实测 | 真飞书账号扫码 + 真发消息测 LLM 回复 | ✅ |

### user 实测验证

- ✅ Phase 1:扫码绑定 OAuth Device Flow 真飞书 app 扫到底,凭证写盘
- ✅ Phase 2:WSS 长连接收到飞书消息 → 走 plugin → opencode session → MiniMax-M2.5-free LLM → 回写飞书
- ✅ multi-turn:同 chat 第二条 "我刚才问的什么?" → "你刚才问的是「介绍一下你自己」"
- ✅ 消息 ack:消息一进来立即 OK reaction
- ✅ tray icon:fox silhouette + 眼睛嘴清晰
- ✅ Settings UI:bot 名 / 提供商 / 模型 显示;openId 脱敏;编辑 model dialog opencode 风格

## 已知 trade-off / FUTURE

1. **archived session GET 401**:opencode-cli sidecar 重启**之前**创建的 session,直接调 GET `/session/{id}/message` 返 401(InstanceState 不预 load 历史 session),走 `/api/session/{id}/message` httpapi 子树 200。当前绕过方案:**chat-session-store 仅 in-memory 复用,sidecar 重启后所有 chat 第一条消息开新 session**(persist write 仍在,read 暂未启用)。代价:multi-turn memory 不跨 sidecar 重启;同 sidecar lifetime 内 OK。FUTURE:改 plugin 直接走 `/api/...` 路径绕过 InstanceState。
2. **dispatcher echo bug**:之前 dispatcher 累积 user prompt 自己的 text part 导致 reply echo,改用 idle 信号 + setImmediate + `session.messages` 拉 last assistant text(commit `106a8a551`)。
3. **bot 名刷新延迟**:user 在飞书后台改名后 → DeskFox **重启**才同步(B 方案,启动时后台 best-effort 拉一次)。要立即同步可加手动刷新按钮,本期不做。
4. **群组消息 / @ 触发 / 文件 / 图片**:目前只测了 p2p 私聊文本消息,Phase 3 处理。
5. **agent UI 选择**:`account.agent` 当前 hardcoded `"build"`(opencode 内置 build agent)。Phase 3 加 UI 选项跟 model 同位置。
6. **archived session 持久化(已 archive)**:plugin 创建的 session 立即 `_client.patch` 加 `time.archived` 让 GUI sidebar 默认不显(避免 user 误点击 plugin session 崩)。

## 关键架构决策

### X1 — plugin 自带 server(单 IM 场景)

详见 `architecture.md`。

- **现在(单 IM)**:plugin 自带 HTTP server,GUI 通过 Tauri command + `~/.opencode/feishu-plugin-server.json` 端口文件 forward 调
- **未来 N=2 IM**:每个 IM plugin 自带 server,GUI 配两套 port file
- **未来 N≥3 IM(重构点)**:抽 `@opencode-ai/im-bridge-core` plugin 做 channel registry,各 IM plugin 退化为 channel handler 注册到 core

### opencode plugin 6 个反直觉踩坑

落 memory `reference_opencode_plugin_quirks.md`,Phase 2 闭环踩到的坑:reply echo race / archived 401 / archive 防 GUI 污染 / directory 隔离 / 模块级单例 / dev channel httpapi default。

## R4 override 用量(本 feat)

3 笔(全 bun.lock 自动重生,跟 d557c3261 / 9fa923e87 同等场景):
- `d8b39ca7c` workspace setup
- `18640d331` Phase 1 加 qrcode 依赖
- `a044eee38` C1.6 加 base64 依赖

## 回退方法

```sh
# 单笔回退某 commit
git revert <commit-hash>

# 整体回退本 feat(回到 dev 主干)
git checkout dev
git branch -D feat/feishu-bridge   # 仅当确认整个 feat 不要

# 关闭飞书桥接但保留代码
# 用户编辑 ~/.config/opencode/opencode.json 删 plugin 那行,sidecar 不再加载即停
```

## 影响范围

- 新功能完全 fork-only,sst/opencode 上游 0 行代码改
- 改的几个上游文件均加 FORK marker(`lib.rs` / `Cargo.toml` / `dialog-settings.tsx` / 三本 i18n)
- bot info / OAuth Device Flow 调飞书官方 OpenAPI(open.feishu.cn / open.larksuite.com),不依赖任何第三方
- 0 OpenClaw 依赖(独立软件,user 不装 OpenClaw)
