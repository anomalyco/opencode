---
feat-id: feishu-bridge-imbot-agent
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-bridge-imbot-agent — plan

## 决策轨迹

### 选项对比(spec 阶段)

| 方案 | 实施成本 | 主 GUI 影响 |
|---|---|---|
| A. 全局收紧 — user opencode.jsonc 顶层加 `permission: { bash: ask, ... }` | 30 行 Rust setup hook | ⚠️ **影响主 GUI**(build agent merge user → 同一份 permission) |
| **B. per-agent 飞书专属** — 加 `imbot` agent + 飞书绑账号默认 agent="imbot" | 50 行 Rust + 5 行 TS + UI 文案 | ✅ **0 影响**,主 GUI 仍走 build 默认 allow |
| C. 上游 PR — `unattended` flag | 上游评审周期 | — |

**选 B**,理由:user 主 GUI 体验 0 摩擦 + 语义清晰("unattended IM 桥接走专属安全 agent")+ 上游 schema 原生支持 per-agent permission(`AgentSchema.permission: Schema.optional(ConfigPermission.Info)`)。

### Spike 验证(开发前)

不开分支,纯沙盒实验:
1. 临时改 `~/.config/opencode/opencode.jsonc` 加 custom agent
2. 重启 sidecar → curl `/agent` endpoint
3. 验证:
   - ✅ opencode 启动**无 schema validation 错误**,识别 `feishu_safe`(spike 时叫这名)
   - ✅ `/agent` endpoint 返回的 imbot permission 跟我配的一致(bash/edit/write/apply_patch/webfetch 都 ask)
   - ✅ `build` agent permission 在 spike 中**完全没变**(主 GUI 不受影响)
   - ✅ `native: false` 标识它是 user-defined agent

Spike 完整还原 user config,正式开发用 `imbot` 命名(user 决策,更通用,future Slack / 其它 IM 桥接复用)。

### 命名:`feishu_safe` → `imbot`

user 拍板:虽然当前只有飞书桥接,但 IM bridge 是更通用的概念,future Slack/WeChat 桥接复用同 agent 合理。改成 `imbot`(IM bot 缩写,3 平台命名一致)。

### 不设 `prompt` 字段是关键

verify 后确认:opencode `session/llm.ts:107` 行为是 agent 没 prompt → fallback 到 `SystemPrompt.provider(input.model)`。**build agent 也没 prompt**(看 `agent.ts:111-126` block 没 prompt 字段),所以 imbot 跟 build 实际跑用同一份 system prompt。

→ "imbot 能力跟 build 完全一样,只权限不同" 100% 成立,不需要复制 build 的任何额外配置。

### idempotent 设计取舍

inject_imbot_agent 选 **"已有 imbot 完全跳过"**(不 merge / 不更新),理由:
- user 可能手动把 `bash: "ask"` 改回 `bash: "allow"` 表达"我信任自己用得明白"
- 我们如果每次启动 force-overwrite 会覆盖 user 的选择,违反"尊重 user 显式调整"原则
- 跟 plugin 路径注入(`inject_plugin`)的 idempotent 语义对齐 — user 改了不动

trade-off:future imbot spec 升级(比如加新敏感目录),user 不会自动拿到。可加版本号字段或显式 reseed flag,但本笔暂不做。

## 顺序

1. Rust setup hook:`inject_imbot_agent` + 5 单测
2. TS default agent 改 build → imbot:`config-schema.ts` + `account-store.ts` + 2 单测
3. 注释 / 文档更新:`feishu-edit-account-dialog.tsx` 注释
4. 三文档 + INDEX + 改动日志
5. typecheck 全过 + Rust cargo test + bun test

## 验证策略

**不实际 build .app 重测飞书 IM**(scope:核心机制 spike 阶段已验证)— Rust 单测覆盖 inject 行为,TS 单测覆盖 saveAccount 默认值,user spike 时实测过 opencode `/agent` endpoint 识别 custom agent 正确。

下次 user 重新绑账号(或者 user 显式 edit `~/.opencode/feishu-config.json` 把 agent 改成 imbot)后,可在飞书发触发权限的消息验证 imbot 实际跑 + 卡片弹的行为跟 build 一致。

## 不做(scope-limited)

- edit dialog 加 agent 选择 UI — **当前飞书老用户极少**,user 重绑即默认 imbot,真要保留老账号也可直接 edit jsonc 改 agent;不专开 UI feat
- 强制 migration 老 user agent build → imbot(违反尊重 user 显式选择原则)
- `message-pipeline.ts:49 / 93` latent comment 修复(不在 scope)

## 关联

- 起源:`feishu-bridge-permission-card`(已实测 7 场景全过)落地后的安全审计 — permission card 是被动审批机制,但 unattended 场景下没人 review,根本问题在"默认权限太宽"。
- 上游设计:`build` agent default 由上游 sst/opencode 控制(无 FORK marker,fork 没改过)— 上游针对 GUI 场景设计合理,但 unattended 场景缺位。本笔走 fork-only per-agent override 路径,不动上游。
