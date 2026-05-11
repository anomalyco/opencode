---
feat-id: feishu-bridge-imbot-agent
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-bridge-imbot-agent — spec

## 一句话

飞书桥接默认 agent 从 `build` 切到新加的 `imbot` — 同 `build` 能力 / 同 system prompt,只把 unattended 远程触发场景下危险的工具(`bash` / `edit` / `write` / `apply_patch` / `webfetch` + 敏感目录 `read`)默认设 `ask`,user 主 GUI 不受任何影响。

## 起源

`feishu-bridge-permission-card` 落地实测后做的安全审计发现:

1. **opencode build agent 默认 permission 是 `*: allow`**(`packages/opencode/src/agent/agent.ts:140-160`),设计假设是 GUI 场景下 user 实时审批 permission card → "default allow + 弹卡能挡" 即可。
2. **飞书桥接打破这个假设** — agent 是 **unattended 远程触发**(任何能给 bot 发消息的人都能驱动),permission card 即使弹也没人立刻审批 → 默认 allow 等价于把 RCE 权限授给所有能 @ bot 的人。
3. **更糟的是 prompt injection vector**:LLM 用 `webfetch`(默认 allow)拉的网页里若含 prompt injection,LLM 可能被诱导主动调 `bash`(也默认 allow)做数据 exfil — 完整攻击链不需 user 介入,user 不知情。

## 范围

### A. 加 `imbot` agent(setup hook 注入到 user opencode.jsonc)

新增 `feishu_plugin_install::inject_imbot_agent`,跟 plugin 路径注入同 setup hook 调用,idempotent:
- user config 已有 `agent.imbot` → 完全跳过(尊重 user 手动调整,即使 user 改回 allow)
- user config 有 `agent` 字段但没 `imbot` → merge 加 imbot,其他 agent 不动
- user config 没 `agent` → 创建 `agent: { imbot: ... }`

注入内容(spec 见 `feishu_plugin_install.rs::imbot_agent_spec`):
```jsonc
"imbot": {
  "description": "DeskFox IM 桥接专用 agent — 同 build 能力,但 unattended 场景下危险工具默认 ask",
  "permission": {
    "bash": "ask",
    "edit": "ask",
    "write": "ask",
    "apply_patch": "ask",
    "webfetch": "ask",
    "read": {
      "*": "allow",
      "*.env": "ask", "*.env.*": "ask", "*.env.example": "allow",
      "**/.ssh/**": "ask",
      "**/.aws/**": "ask",
      "**/.kube/**": "ask",
      "**/.gnupg/**": "ask",
      "**/Library/Keychains/**": "ask",
      "**/AppData/Roaming/Microsoft/Crypto/**": "ask"
    }
  }
}
```

**不设 `prompt` 字段**:opencode `session/llm.ts:107` `input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)` — 没 prompt 时 fallback 到 provider default。`build` agent 自己也没设 prompt(`agent.ts:111-126` 没 prompt 字段)。所以 imbot 跟 build **用完全一样的 system prompt,LLM 能力等价**,只权限不同。

### B. 飞书 saveAccount default agent: `"build"` → `"imbot"`

- `core/config-schema.ts:107` zod schema default
- `feishu/account-store.ts:139` saveAccount fallback

**已绑账号(老 user agent=build)不强制 migrate** — `existing?.agent ?? "imbot"`,有 existing.agent 就保留。user 自行决策(edit jsonc 改 / 重绑 / FUTURE 加 UI 切换)。

## 验收

- Rust `inject_imbot_agent` 5 个 unit test(空 config / idempotent / merge 不影响其他 agent / jsonc 注释 fallback / read 敏感目录全配)
- TS `saveAccount` 2 个 unit test(新绑默认 imbot / 老账号保留 build)
- spike 阶段实测 `/agent` endpoint 已确认 opencode 识别 custom agent + permission 正确生效 + build agent 不受影响

## 不做

- **edit dialog 加 agent 选择 UI**:当前 edit dialog 只显示 model,没 agent 字段。**当前飞书桥接老用户极少**,无需专门做 UI 升级路径 — user 重绑账号即走默认 imbot;真想保留老账号但改 agent,直接 edit `~/.opencode/feishu-config.json` 把 `agent: "build"` 改成 `"imbot"` 重启即可。
- **`message-pipeline.ts:49 / 93` latent comment**:friendlyErrorReply 文案提到 "build agent 默认 model 自动设置",实际 `data.default` key 是 provider id 不是 agent name(同 settings-feishu A4.A latent bug)。本笔不修(scope creep)。
- **i18n 化 imbot warning / 安全说明文案**:目前 spec / changelog 中文为主。

## 规模

Medium — 1 Rust 函数 + 1 ts default 改动 + 1 zod schema 改动 + 5 Rust unit test + 2 TS unit test + 三文档落盘。
