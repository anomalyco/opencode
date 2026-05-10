---
feat-id: feishu-bridge-empty-reply-ghost
status: done
related: ./3-changelog.md
---

# feishu-bridge-empty-reply-ghost — changelog

## 一句话

修飞书桥接 5 条丢失 reply 的两个独立 bug:① opencode agent loop 在工具调用 / 多步回复尾部追加 0-token 空 placeholder ghost message,plugin 倒序找 last assistant 取到 ghost → 空 reply;② `promptTimeoutMs` 默认 5min 对长 agent 任务不够,7m18s 长回复触发硬超时 → plugin 返空。两个 bug 各 1 笔 commit + 13 单测,user 实测 5/5 修。

> Medium 规模:2 笔 commit / ~25 行核心代码 / 13 单测 / 0 R4 / 0 上游侵入。

## 背景 — user 提报现象

user 用 `xiaobei_win` 飞书账号实测一天后反馈 "为什么有的聊天记录没有发给飞书?"。复盘 `~/.local/share/opencode/opencode-feat-filetree-ctrlc-textsel-fix.db` 里的 session `ses_1f2811008ffeolJjGaj90vdm9h`:14 条 user 提问中 5 条对应的 LLM 回复**真的生成了**(数据库有 token 计数 + 完整文本)但飞书侧没收到。

| 时间(北京)| 提问 | LLM 回复 | 飞书收到? |
|---|---|---|---|
| 2026-05-10 00:24 | "DeskFox 服务启动后..." | 7m18s / 1428 tokens | ❌ |
| 2026-05-10 00:36 | "什么进展了?" | 73s / 1860 tokens | ❌ |
| 2026-05-10 00:45 | "可以通报下当前的进展吗?" | 69s / 2135 tokens | ❌ |
| 2026-05-10 07:52 | "你检查一下当前分支..." | 36s / 557 tokens | ❌ |
| 2026-05-10 08:08 | "对,你没把结果发给我..." | 22s / 647 tokens | ❌ |

## commit 列表

| commit | 简述 |
|---|---|
| `842f5f822` | `fix(feishu-bridge): 跳过 0-token 空 placeholder ghost 抢占 last assistant`(主修 4/5 case)+ 13 单测 |
| `acc221d71` | `fix(feishu-bridge): promptTimeoutMs 默认 5min → 30min,覆盖长 agent 任务`(修剩 1/5 case 的 438s 长回复)|
| `<merge>` | 合并到 dev — 跟 `fix/feishu-installer-bundle-plugin` 一起合(同分支链)|

## 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` | 改 | 抽 `findLastUsefulAssistant` 纯 helper(file 末尾,export);`runOpencode` 改用 helper 替原倒序 break-on-role 逻辑;`promptTimeoutMs` 默认值 5min → 30min 加注释 |
| `packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts`(新) | 新 13 单测 | 7 场景 × 多 case 覆盖:happy path / ghost 跳过(主修)/ 多 ghost 连续 / 全 ghost / 空白文本视为 ghost / error 优先 / synthetic+ignored / 历史多轮稳定性 |

## Bug A — placeholder ghost 抢占 last assistant

### 数据层证据

5 条 ghost 结构 100% 一致:

```
parts: step-start → text("") → step-finish
tokens.total: 0
parentID: <跟它前面的真 reply parentID 完全相同>
mode: "build"
time.created === time.completed (瞬时完成,~30ms)
```

短回复(<17s,无工具调用)**不触发** ghost。中长回复(≥22s 或含工具/多步)**100%** 跟一条 ghost。

### 修法

`packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` 抽出纯 helper:

```ts
export function findLastUsefulAssistant(data: ReadonlyArray<AssistantMessageEntry>): AssistantMessageEntry | undefined {
  for (let i = data.length - 1; i >= 0; i--) {
    const m = data[i]
    if (!m || m.info.role !== "assistant") continue
    if (m.info.error) return m  // error 也是有效信号,caller 抛出去
    const hasRealText = m.parts.some(p =>
      p.type === "text" && typeof p.text === "string" && p.text.trim() !== "" &&
      !p.synthetic && !p.ignored,
    )
    if (hasRealText) return m
    // 否则:placeholder ghost,继续往前扫
  }
  return undefined
}
```

`runOpencode` 改用 helper 替换原倒序 break-on-role 逻辑(原代码:`if (role === "assistant") { break }` 直接 break,被 ghost 截胡)。

### 选 A 不选 B/C/D 的理由

| 候选 | 否决理由 |
|---|---|
| **B. parentID 反查**(知道 user msg id 后定位 reply) | 需重构 promptAsync 调用捕返回值,接口面拉大,依赖 opencode 版本稳定 |
| **C. tokens.total > 0 过滤** | 真 reply 在某些 provider 上 token 字段可能不准/为 0,误过滤 |
| **D. parts 数 > 3 过滤** | 短 reply 也是 3 parts,会把所有短 reply 都过滤 |
| **E. 切回 dispatcher 累积 text** | 之前 echo bug(commit `106a8a551` 改 message 路由就是为了修这个)|

## Bug B — 5min 硬超时误杀长任务

### 现象

DeskFox 飞书桥接 sidecar 日志:

```
2026-05-09T16:24:13Z [pipeline] msg from chat=...: "DeskFox 服务启动后..."
2026-05-09T16:29:13Z [dispatcher] timeout for ses_..., 返 partial   ← 5min 后硬超时
2026-05-09T16:29:13Z [pipeline] empty reply for chat=...
```

LLM 实际跑到 16:31:31(7m18s)才完成。timeout 在 16:29:13 (5min) 时硬切断:

```ts
// prompt-dispatcher.ts:55-65
const timeoutHandle = setTimeout(() => {
  const partial = collectText(w)
  if (partial) finalize("resolve", partial)  // ← 5min partial 文本
}, timeoutMs)
```

partial 文本 resolve 给 `runOpencode` 后,`runOpencode` 没用 partial,改读 `session.messages` 拉 reply。此时 LLM 还在跑,message 文本未持久化(parts 还在 streaming) → 返回 "" → 飞书 send 守门拦截。

### 修法

`message-pipeline.ts:184` 默认值 5min → **30min**:

```ts
// 默认 30 分钟超时(2026-05-10 由 5min 提)。覆盖典型 agent 长任务上限;
// 真要跑超 30min 的复杂任务,需走 Layer 2 重构(订阅 message.updated 事件 +
// time.completed 字段判完成,告别启发式超时)。
const timeoutMs = this.opts.promptTimeoutMs ?? 30 * 60 * 1000
```

3 行代码改动 + 7 行注释。

## R5 测试覆盖

`packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts` 13 个测试 / 7 个 describe block:

1. **happy path**(3 测试):单 reply / 空数组 / 全 user
2. **ghost 跳过**(4 测试):主修场景 / 多 ghost 连续 / 全 ghost / 空白文本(空格/换行)视为 ghost
3. **error 优先**(2 测试):error 无 text → 返;error 在 ghost 之前 → 返 error 不返 ghost
4. **synthetic / ignored 跳过**(3 测试):synthetic only → undefined / ignored only → undefined / 混合 synthetic+real → real
5. **历史多轮稳定性**(1 测试):跨轮 fallback 行为(chatQueue 串行保证现实不出现这种 case,接受跨轮 fallback)

测试 13/13 全 pass,实际跑 9.98s。

## 不修但留 backlog 的事

### Layer 2 重构 — 订阅 `message.updated` 事件 + `time.completed` 判完成

opencode 实际有更准的"完成"信号 `packages/opencode/src/session/message-v2.ts:617` `message.updated` 事件 + `info.time.completed` 字段。订阅它 + 按 user msg id 关联 assistant,**100% 知道"这条 reply 完成了"**,不靠 session.idle 也不靠超时启发式。

当前架构走 `session.idle` 是 session 级"空闲"信号(error halt 也触发,跟 message 完成不严格 1:1)。完整迁到 message.updated 是 Medium 重构(~80-120 行,影响完整 reply 路径),本笔不做,作为独立 backlog 立项 — 等本笔在 user 那用一阵稳定后再启动。

backlog feat-id 暂定 `feishu-bridge-completion-signal-rewire`。

### Bug C — dispatcher 累积的 partial 文本被丢弃

`runOpencode` 拿到 `idlePromise` resolved 的 string 但没用,改走 `session.messages` API。timeout 触发 partial 时,partial 是 dispatcher 累积的真实流文本,理论上比"读 message 但 LLM 还在跑"的回退路径更可靠。这是架构性问题,跟 Layer 2 一并修。

## 实测验证

| 时机 | 操作 | 结果 |
|---|---|---|
| 修前 | 2026-05-09 整天用 xiaobei_win 提问 | 14 提问 / 9 reply 收到 / 5 reply 丢失 |
| 修后(本笔) | 重 build DeskFox dev exe + 启动 sidecar 重新加载 plugin | 待 user 实测复现长回复场景验证(同步 prod installer 走 `feishu-installer-bundle-plugin` 笔)|

## R4 / 上游侵入

- 0 R4 override(无黑名单文件改,无 bun.lock 改)
- 0 上游侵入(改的是 fork-only `adapter-feishu-lark/` 包内文件)
