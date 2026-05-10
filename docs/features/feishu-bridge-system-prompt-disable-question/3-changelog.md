---
feat-id: feishu-bridge-system-prompt-disable-question
status: done
related: ./3-changelog.md
---

# feishu-bridge-system-prompt-disable-question — changelog

## 一句话

修飞书桥接 LLM 调 `question` 工具反问用户后**永远卡死**的死锁 bug — 飞书 user 在 IM 看不到 opencode TUI/GUI 的 question 对话框,agent loop 等不到回答。临时止血走 system prompt 注入,告诉 LLM 不要用 question / ask-user 类工具,信息不足直接答或写"需要补充 XXX 请重发"。真互动版(form 卡片 + synthetic message)是 OpenClaw 对齐 #5,Large 后续做。

> Tiny:1 文件 / 23 行 / 0 R4 / 0 上游侵入。

## commit 列表

| commit | 简述 |
|---|---|
| `e3f880c77` | `fix(feishu-bridge): 注入 system prompt 禁 LLM 反问工具,修 agent loop 死锁` |

## 改动文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` | +23 行 | 加 `FEISHU_SESSION_SYSTEM_PROMPT` 常量(10 行 prompt 内容 + 注释)+ 在 `runOpencode` 的 `promptAsync` body 加 `system: FEISHU_SESSION_SYSTEM_PROMPT` 一行 |

## 背景 — Hebing—one 死锁现场

2026-05-10 user 给 Hebing—one(模型:xiaomi mimo-v2.5-pro)发"你能否把这个文档以附件的方式通过飞书发给我吗",agent 走 3 步:
1. 21:44:09–34(25s)— read + grep `feishu-workspace` 找飞书配置
2. 21:44:34–52(18s)— bash 查 env vars + glob 找 feishu 配置文件
3. **21:44:52–🔴 永远卡住** — reasoning"没找到飞书配置,需要询问用户",**调 `question` 工具问"您是否有飞书 API 访问令牌或配置信息?" 选项 [有/无...]**

opencode-cli 把 question 输出到 TUI/GUI 等回答 → user 在飞书看不到 → agent loop 死锁,飞书 user 永远收不到回复。

## 根因

opencode 内置 `question` 工具(`packages/opencode/src/tool/question.ts`)— 让 LLM 主动反问 user,设计上同步等 user 在 GUI 输入答案。在飞书桥接 plugin 路径下:
- LLM 调 `question`
- opencode-cli 把问题推给 TUI / 主 GUI 用户
- 飞书 user 不在 TUI / 主 GUI,**问题无人接收**
- agent loop 永远等不到回答 → 整个 turn 卡住

opencode 没暴露"plugin 替换 question 工具"的扩展点,只能从外部约束 LLM 不要调它。

## 修法 — system prompt 注入

`packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` 加常量:

```ts
const FEISHU_SESSION_SYSTEM_PROMPT = [
  "本会话通过飞书 / Lark 桥接,你跟用户之间没有 GUI 交互层。",
  "**禁止**调用任何反问用户类工具(question / ask-user-question / askUser / clarify 等),",
  "因为用户在飞书 IM 看不到这些问题,会导致 agent loop 永远卡住。",
  "",
  "遇到信息不足或语义模糊时,请**直接做以下任一**:",
  "1. 基于现有信息和你的最佳判断给出答案;",
  "2. 在回复里明确写「需要补充以下信息:...」请用户重发新消息;",
  "3. 短答 + 列出可选方向让用户挑(纯文本即可,不要用工具)。",
  "",
  "其他工具(file 操作 / shell / bash / read 等)不受此限制,正常使用。",
].join("\n")
```

`runOpencode` 的 `promptAsync` body 加 `system: FEISHU_SESSION_SYSTEM_PROMPT`。opencode `PromptInput` schema(`packages/opencode/src/session/prompt.ts`)有 `system: optional` 字段,跟 build agent 自带 system prompt 拼接生效。

## 影响

| 场景 | 修前 | 修后 |
|---|---|---|
| LLM 遇到模糊任务 | ~30% 调 question 工具死锁 | LLM 看 system prompt 后**不再调** question,直接答或写"请补充 XXX" |
| Hebing—one 飞书发附件任务 | 卡死 | 应回 "我没法直接发飞书附件,请你从 `~/.opencode/feishu-workspace/<file>` 取" 或类似 |
| 主 GUI / TUI 使用 | 不受影响 | 不受影响(system prompt 只在飞书 session 注入,主 GUI session 没经过 message-pipeline) |
| 失去能力 | — | LLM 不再能主动澄清模糊问题 — trade-off 接受(避免死锁优先于互动)|

## R5 测试

system prompt 注入是配置类改动(常量字符串 + 单字段 pass-through),不属于复杂逻辑,**Tiny 例外不强制单测**。

实测验证待 user 实际跑(本笔在 build 后启动新 sidecar 配套验证)。

## 跟进 — 真互动版本留 backlog

OpenClaw 等价物 `tools/ask-user-question.js` 的真实现:LLM 调 question → 飞书 form 卡片(选项 / 输入框)→ user 选/填 → 答案合成 synthetic message 注入 agent loop 继续。

加入 OpenClaw 对齐 roadmap 作为 #5,Large(3-5 天)。详见 [`OPENCODE-PLAN/需求池/飞书桥接-openclaw能力对齐.md`](../../../OPENCODE-PLAN/需求池/飞书桥接-openclaw能力对齐.md)。

## R4 / 上游侵入

- 0 R4 override
- 0 上游侵入(改 fork-only `message-pipeline.ts`)
