---
feat-id: feishu-bridge
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 飞书桥接架构记录(选 X1 plugin 内自带 server)

> **决策时间**:2026-05-09
> **决策人**:user(基于稳定性 / 安全性 / 未来扩展性 三维评估)
> **目的**:对齐 OpenClaw channel plugin 模式,**0 修改 opencode 主程序 / 0 修改 DeskFox 主程序**

## 当前架构(X1)

```
┌──────────────────────────────────┐
│   DeskFox 主进程(0 修改)        │
│   - GUI Settings → 飞书桥接 Tab  │
│   - feishu_adapter.rs:lazy 读   │
│     ~/.opencode/feishu-plugin-   │
│     server.json → forward HTTP   │
└──────────────────────────────────┘
              │ Tauri command
              ▼
┌──────────────────────────────────┐
│  opencode-cli sidecar(0 修改)    │
│  ┌─────────────────────────────┐ │
│  │ adapter-feishu-lark plugin  │ │
│  │  - localhost HTTP server    │ │
│  │    /oauth/* /accounts/*     │ │
│  │  - 写 feishu-plugin-        │ │
│  │    server.json(0600)       │ │
│  │  - 飞书 WSS 长连接          │ │
│  │  - input.client.session.*  │ │
│  │  - event hook 路由 events  │ │
│  │    → PromptDispatcher      │ │
│  │  - lark.message.create     │ │
│  └─────────────────────────────┘ │
└──────────────────────────────────┘
```

**关键路径**:
1. plugin 启动(opencode-cli sidecar 启动时由 plugin loader 加载)
2. plugin 起 HTTP server,写 `~/.opencode/feishu-plugin-server.json`(含 url/username/password,0600)
3. plugin `listAccounts()` 读 `~/.opencode/feishu-config.json` → 起飞书 WSS
4. 飞书消息进 → plugin 内 pipeline → opencode session.create + promptAsync
5. opencode 内 LLM 调用 → events → plugin event hook → dispatcher 累积 token → resolve
6. lark.im.v1.message.create 发回飞书

## 决策依据(为什么 X1 而非 X3)

三维度评估(详见 commit message + 对话记录):

| 维度 | X1(plugin 内自带 server) | X3(GUI 直调飞书) | 结论 |
|---|---|---|---|
| 稳定性 | 8/10(少 file watcher 链路 / 不依赖 CORS)| 7/10(file watcher 跨平台 / CORS 风险) | X1 略胜 |
| 安全性 | 8/10(localhost server + Basic auth + 0600 token file)| 8.5/10(少一个 attack surface) | X3 微胜 0.5 |
| 未来扩展性 | 9/10(plugin server 是 server-side rich logic 天然 host)| 6/10(server-side 功能要逐步加回 server,绕一圈)| **X1 大胜 — 决定性维度** |

**扩展性决定一切** — Phase 3-6 spec 列了 12+ G 项功能(健康检查 / 副用户绑定码 / per-account model 选择 / heartbeat / AskUserQuestion 等),大部分需要 server-side rich logic + GUI 双向交互。X1 的 plugin server 是这些功能的天然 host;X3 想加 server-side feature 等于把 server 一点点加回来,绕了一圈。

## 多 IM 演进路径(未来重要)

opencode plugin 系统**没有"channel registry"概念** — 每个 plugin 是独立单元,opencode 不调度它们之间的关系。如果未来支持多 IM(飞书 + Slack + Discord 等),技术上每个 IM plugin 都自己起 server 可行,但 N 增长后管理成本爆炸。

OpenClaw 平台用的是 **channel registry 模式**:核心 plugin 起一个 server,各 IM channel 是 module 注册到核心,共用 server。

我们的演进路径:

| 阶段 | 架构 | 触发条件 |
|---|---|---|
| **现在(只飞书)** | X1 — feishu plugin 自带 server | 当前实施 |
| **加第 2 个 IM** | 仍各自带 server,GUI 配两套 port file 即可 | 添加 Slack 等 |
| **N≥3 IM(重构点)** | 造 `@opencode-ai/im-bridge-core` plugin 做 channel registry,各 IM plugin 退化为 channel handler module 注册到 core | IM 数量 ≥ 3 |

**重构成本预测(N≥3 时)**:
- 创建 `packages/im-bridge-core/` workspace(新 plugin)
- 抽 `server.ts` + `account-store.ts` 通用部分到 core
- 各 IM plugin 改:移除 server 启动 / 启动时 `core.channelRegistry.register(channel, handler)`
- DeskFox GUI 改 Tauri command dest,只对接 core server
- 预计 **1-2 天**,代码大部分 reuse

**当前 X1 不阻挡未来重构** — plugin 内代码已按职责分层(`server.ts` / `account-store.ts` / `wss-client.ts` / `message-pipeline.ts` / `prompt-dispatcher.ts` / `feishu/oauth.ts`),抽 server 到 core 时各模块不需要大改。

## 安全模型

- plugin server bind `127.0.0.1`(不对外)
- 启动时随机生成 24-byte hex password,Basic auth 强制
- password 文件 `~/.opencode/feishu-plugin-server.json` 权限 0600(同 user 隔离)
- 飞书 OAuth secret 落盘 `~/.opencode/feishu-secrets/<id>.key`(SecretRef file mode 0600)
- 主 config 文件 `~/.opencode/feishu-config.json` 0600(只含 SecretRef pointer,不含 secret 明文)
- 跟 opencode-cli 自身 sidecar(`~/.opencode/server-credentials.json`)同一安全等级

## 关键文件清单

```
packages/adapter-feishu-lark/
  src/
    plugin.ts                          ← opencode plugin entrypoint(start server + WSS)
    server.ts                          ← HTTP server(/oauth /accounts)
    feishu/
      oauth.ts                         ← 飞书 OAuth Device Flow(init/begin/poll)
      account-store.ts                 ← ~/.opencode/feishu-config.json 读写 + SecretRef
      wss-client.ts                    ← @larksuiteoapi/node-sdk WSClient 包装
      message-pipeline.ts              ← 飞书消息 → opencode → 飞书回写
      prompt-dispatcher.ts             ← event hook ↔ pipeline waiter 桥梁
      throttle.ts                      ← FlushController(streaming card patch 用)
      chat-queue.ts                    ← 同 chat 串行队列
      dedup.ts                         ← msgId+ts TTL Map(WSS 重放过滤)
    core/
      secret-ref.ts                    ← 三档凭证存储(plaintext/env/file 0600)
      config-schema.ts                 ← zod schema(account/group/heartbeat/...)

packages/desktop/src-tauri/src/
  feishu_adapter.rs                    ← Tauri commands → plugin server HTTP forward
                                          (lazy 读 feishu-plugin-server.json)

packages/app/src/
  components/
    settings-feishu.tsx                ← Settings 飞书桥接 Tab(已绑定列表 + 添加/删除)
    feishu-bind-dialog.tsx             ← 扫码绑定弹窗(QR + user_code + 状态机)
  utils/feishu-config.ts               ← Tauri command invoke wrapper

~/.config/opencode/opencode.json       ← user 注册 plugin
~/.opencode/feishu-plugin-server.json  ← plugin 写,主进程 lazy 读
~/.opencode/feishu-config.json         ← accounts(SecretRef pointer)
~/.opencode/feishu-secrets/*.key       ← 真 secret(0600)
```

## Plugin 注册方式

user `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "file:///path/to/opencode-fork/packages/adapter-feishu-lark/src/plugin.ts"
  ]
}
```

dev 用绝对路径,**production**(发布后)改为 npm package:

```json
{
  "plugin": ["@opencode-ai/adapter-feishu-lark/plugin"]
}
```

(npm 发布是 backlog,DeskFox 安装时自动 setup `opencode.json` 也是 backlog)

## 跟 OpenClaw 架构的对应关系

| 角色 | OpenClaw | 我们 |
|---|---|---|
| 平台主程序 | OpenClaw 平台 | opencode-cli sidecar(由 DeskFox spawn)|
| 飞书 channel | `@larksuite/openclaw-lark` | `@opencode-ai/adapter-feishu-lark` plugin |
| 平台 admin server | OpenClaw 平台自带 | plugin 内自带(X1)/ 未来 core plugin 提供(N≥3 重构后)|
| 各 IM 共享 channel registry | ✅ 内置 | 当前 N=1 不需要;未来需自造 core plugin |
| GUI 入口 | OpenClaw 平台 admin web | DeskFox Tauri webview |

## 强约束 / 不能做的事(memory 持久化)

详见 `~/.claude/projects/.../memory/`:
- **🚨 飞书桥接不依赖 OpenClaw 任何包 / 平台**:不引 `@larksuite/openclaw-*` npm 包,DeskFox 是独立软件
- **🚨 飞书桥接走 DeskFox 常规绑定模型,不走外接 plugin agent**:adapter promptAsync 不传 agent / model,用 user 全局 default + opencode 自带免费 model 兜底
- **🚨 不修改 opencode 主程序 / 不修改 DeskFox 主进程的核心流程**:fork-only 改动只在我们自己的代码区,X1 plugin 模式确保这个约束

---

**本文档是飞书桥接架构的 source of truth**,后续重构 / 新 IM 接入时先读本文档 + 决策依据。
