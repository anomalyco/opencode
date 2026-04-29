---
feat-id: claude-code-loop-fix
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# claude-code-loop-fix — spec

> **⚠️ R4 override 必审签** — 本 feature 改 packages/opencode/(黑名单核心,改动规则.md 明文"绝对不动"),实施前 user 必须签 1-spec。本季度 override 配额本次后 = 2/2(满)。

## 一句话

修复 DeskFox 用 `claude-code` plugin(我们 fork-only 的本地 plugin)时 step loop 永久卡死的 bug — 给 `packages/opencode/src/session/prompt.ts` 加一段 fork-only 兜底 break(走 R4 override + 严格 FORK marker)。

## 触发原因

### 现象(稳定复现)

DeskFox release build + `claude-code` plugin(`D:\project\deskfox-plugins\claude-code\`)激活,user 选 Claude Sonnet/Opus/Haiku 任一模型,发任意消息(如 "你好"):

1. Claude 正常返回完整回复(text-start → text-delta → text-end → finish stop)
2. ~1 秒后,opencode 的 `runLoop`(`prompt.ts:1313` while(true))**不 break**,继续 step
3. 每 1.5 秒重新 doStream;plugin 见 prompt 末尾是 assistant role(没新 user 输入)走 short-circuit 返空 stream
4. opencode 不识别空 stream 等于 "应该停",继续循环
5. UI 底部"思考中"**永久卡死**,▢ 停止按钮不还原 ↑ 发送按钮

### 根因(plugin 侧 5 轮诊断后定位)

代码位置:`packages/opencode/src/session/prompt.ts:1335-1353` step loop 的 break 判定块:

```ts
const lastAssistantMsg = msgs.findLast(...)
const hasToolCalls =
  lastAssistantMsg?.parts.some((part) => part.type === "tool" && !part.metadata?.providerExecuted) ?? false

if (
  lastAssistant?.finish &&                               // 条件 1:finish 存在
  !["tool-calls"].includes(lastAssistant.finish) &&      // 条件 2:不是 tool-calls
  !hasToolCalls &&                                       // 条件 3:没未处理 tool calls
  lastUser.id < lastAssistant.id                         // 条件 4:id 顺序对
) {
  yield* slog.info("exiting loop")
  break
}
step++
```

实测 break 不触发 = 4 项里至少 1 项不满足。具体哪项 false **需要 Phase A 诊断确认**(写 spec 时尚不知)。可能性:

| case | 失败的条件 | 根因猜测 |
|---|---|---|
| 1 | `lastAssistant?.finish` undefined | ai-sdk LanguageModelV2 没把 plugin 的 finish part 传给 opencode message info |
| 2 | `hasToolCalls` true(plugin 已标 providerExecuted) | ai-sdk 把 providerExecuted 写到了别处(不在 part.metadata.providerExecuted) |
| 3 | `lastUser.id < lastAssistant.id` 不成立 | message id 排序问题 |
| 4 | 都满足但还是不 break | control flow 别的早期分支吃掉 break |

### 上游已知状态(2026-04-29 核实)

- 我们 upstream 是 **`sst/opencode`**(不是 plugin agent 工单写的 `anomalyco/opencode`)
- `git show upstream/dev:packages/opencode/src/session/prompt.ts` 该 break 块**跟我们 fork baseline 一字不差**(line 1314-1322 同款)— sst 上**未 fix**
- 在 sst/opencode 上没有相关 commit(grep `loop.*break` / `finish.*reason` 等关键词,upstream/dev 后续 commit 是 cancellation harden / refactor / Effect Schema 迁移,无 step loop 修复)
- 工单引用的 `anomalyco/opencode#17982` / PR #22404:无法通过本地 git 验证(那是另一个 fork 或 typo);即使存在并合了,也不影响我们(我们 follow sst,不 follow anomalyco)
- **结论**:上游短期不会修,自用 fork 必须自带兜底

### 为什么 plugin 层走不通(R1 三级跳判断)

plugin 5 轮已迭代(详见 `D:\project\deskfox-plugins\claude-code\NOTES.md` + git log),covers:

1. cache_control 400 修(空 text block + "continue" 占位)
2. fallback throw → 切回防御性
3. caller short-circuit(prompt 末尾 assistant 时返空 stream)
4. finishReason 永远 "stop"(去掉 toolCallMap.size > 0 ? "tool-calls" : "stop")
5. emit `response-metadata` part(LanguageModelV2 协议要求)

**plugin emit 完整正确**仍卡 → loop 的 break 决策不依赖 plugin emit 内容,**纯粹是 opencode 的 break 条件判断 bug** → R1 第 1/2 级路径(纯新文件 / 接口注入)走不通,**必须深度改上游**(R1 第 3 级)。

## 验收标准

跟工单一致,6 项全过才算 done(详细命令见 [2-plan.md](./2-plan.md) 验收段):

1. **基础对话不卡** — 发"你好",10 秒内完整回复,"思考中"消失,停止按钮还原
2. **多轮对话不卡** — 连续两条消息都正常结束
3. **工具调用不卡** — Claude 调 Read 工具读文件,turn 结束
4. **Bash 工具不卡** — Claude 跑 `git status`,turn 结束
5. **回归** — 现有 `getbot` provider 模型(MiniMax-M2.7、qwen3-coder-480b)依然能用
6. **debug.log 干净** — `D:\project\deskfox-plugins\claude-code\debug.log` 一次完整 turn 后 `short-circuit` 行 ≤ 2(以前会无限刷)

## 不做什么

- **不发上游 PR**(本季度先修自己,以后视情提)
- **不重写 step loop**(只加最小 fork-only 兜底块,原 break 块完全保留作 fallback,减小 rebase 冲突面)
- **不动 plugin 代码**(已确认 plugin 完整正确,5 轮 fix 都对)
- **不做更大范围 refactor**(loop 是核心代码,改最小不破其他场景)
- **不开 R4 第二配额**(本次是本季第 2 笔 override,后续整季严控,有别的需求要等下季度)

## 架构选型

### 路径分析

| 路径 | 选 | 理由 |
|---|---|---|
| **A. cherry-pick 上游 PR** | ❌ | sst/opencode 上没相关 PR;工单引用 PR #22404 是 anomalyco/opencode 的,跟我们 upstream 无关 |
| **B. 自写 minimal fork-only 兜底块** | ✅ | 唯一可行;插在原 break 块**之前**作前置 guard,原块保留作 fallback;rebase 时整段 FORK-BEGIN/END 直接删 |
| **C. 等上游修** | ❌ | sst 没在修,等不到;且 user 自用 fork,不能拖 |
| **D. 修 ai-sdk 层让 finish 传通** | ❌ | ai-sdk 是 npm dep,改它要 patch-package 或 fork dep,维护成本远高于改 prompt.ts 一处 |

### 选定:B(自写兜底)

**实现策略**:

```ts
// FORK-BEGIN: workaround upstream step-loop bug — assistant finish=stop 时强制 break
// 详见 docs/features/claude-code-loop-fix/3-changelog.md (commit <hash>)
// 现象:plugin emit finish=stop 后 opencode runLoop 不 break,卡死 UI
// 上游 sst/opencode dev 当前未修(2026-04-29 核实);本块为 fork-only 兜底
// 上游若以后修了,删除 FORK-BEGIN/END 整段即可恢复主线行为
if (
  lastAssistant?.finish &&
  !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
  lastUser.id < lastAssistant.id
) {
  yield* slog.info("exiting loop (FORK claude-code-loop-fix)")
  break
}
// FORK-END

// 原 break 块保持不动作为 fallback ↓
const lastAssistantMsg = msgs.findLast(...)
const hasToolCalls = ...
if (
  lastAssistant?.finish &&
  !["tool-calls"].includes(lastAssistant.finish) &&
  !hasToolCalls &&
  lastUser.id < lastAssistant.id
) {
  yield* slog.info("exiting loop")
  break
}
```

**关键设计**:
- **前置 guard 不替换** — 原块完全保留,fallback 行为不变
- **跳过 `hasToolCalls` 检查** — 因 plugin 5 轮已确认所有 tool 标 `providerExecuted: true`,但 ai-sdk 可能存到 `part.providerExecuted` 而非 `part.metadata.providerExecuted`,bypass 这一项是 case 2 的兜底
- **白名单更严**:`["tool-calls", "unknown"]` — `unknown` 也跳过避免 ai-sdk 协议演进引入新 unknown reason 时炸
- **依赖 Phase A 诊断结果**:如果 Phase A 显示是 case 1(finish 是 undefined),本兜底**仍不够**(`lastAssistant?.finish` 是 falsy → 兜底也不进),要进一步改成"finish 是 undefined 时也认为可以 break"(只要 `lastUser.id < lastAssistant.id` 且无 tool calls);Phase A 结果决定最终代码

### 实施分阶段(详见 [2-plan.md](./2-plan.md))

- **阶段 A 诊断**(必做先做):插临时 debug log 找出 4 项里哪项 false
- **阶段 B 修复**:按 A 结果选具体修法(case 1/2/3/4 / fallback workaround)
- **阶段 C 收尾**:移除诊断日志,只留 fix 块 + FORK marker

## R4 复核报告

按改动规则.md 第 8 节(R4 黑名单 override)+ 12-fork-跟随升级与协作规范.md R4,以下三项必须论证:

### ① wrapper 不可行性

`packages/opencode/` 是核心业务代码(TypeScript runtime 模块),无法用 fork 常用 wrapper 模式:

- **不能像品牌资源(R3 类)走 build hook 注入** — break 决策在 runtime 中,不是 build-time 资源
- **不能 monkey-patch** — `runLoop` 是 Effect generator,内部 closure 状态多,猴子补丁会破坏 Effect 调度
- **不能 plugin 拦截** — opencode plugin 系统不暴露 session loop 控制点(已查 packages/plugin/);plugin 5 轮迭代证伤
- **不能在 desktop 层(packages/desktop/)拦** — desktop 是 Tauri 壳,只起 sidecar(opencode-cli),不参与 session 决策
- **不能 patch-package ai-sdk** — patch-package 是上游依赖打补丁机制,等价改上游,且 ai-sdk 不在我们仓内,维护成本反而高

**结论**:本 bug 在 step loop 决策点,只能就地改 `prompt.ts`。R1 第 3 级唯一可行。

### ② 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| **R-1 误伤多步 agent** | 中 | 强制 break 让原本应该多 step 的 agent 场景断 | break 条件保留 `!["tool-calls", "unknown"].includes(...)` — 工具调用 / 未知 reason 走原路;只对明确 stop-class finish 触发 |
| **R-2 rebase 冲突** | 低 | 上游若改了 prompt.ts 同位置,rebase 时手解 | FORK-BEGIN/END 包裹 + 显式 tracking 注释,冲突时一眼识别;原 break 块未动,冲突面只在新增段 |
| **R-3 ai-sdk 协议升级引入新 finishReason** | 低 | 新 reason 默认 break(白名单不含)= 更安全 | 用排除式白名单 `["tool-calls", "unknown"]` 而不是包含式 `=== "stop"` |
| **R-4 Phase A 诊断不准导致修错** | 中 | 如果实际 false 是 case 1(finish undefined),本兜底跳不过去,bug 不修 | Phase A 必跑;诊断结果决定 Phase B 路径,不预设;诊断后 spec 可能要补充修订 |
| **R-5 prompt.ts 后续 sst 大改** | 低 | upstream 重构 break 逻辑(如 #24309 refactor 思路),fork 块失效 | 加 tracking 注释 + 季度 health check 关注 prompt.ts 上游 commit;若上游真重写 break,删 fork 块 + 重新评估 |

**总体风险:中**(可接受,fork 自用范围内有限)

### ③ 改动日志论证

- **改动文件**:`packages/opencode/src/session/prompt.ts` — 唯一文件,仅插入 ~15 行 FORK 块,不动原代码
- **影响范围**:
  - claude-code plugin 用户 — bug 修复 ✓
  - 其他 provider(openai / anthropic 官方 / google 等)用户 — 无影响(原 break 块完全保留作 fallback)
  - 现有 getbot provider 用户 — 无影响(同上)
  - sst/opencode 主线行为 — 不变(fork-only 增量,前置 guard 不进则走原逻辑)
- **回退**:`git revert <commit>` 或删除 FORK-BEGIN/END 整段
- **季度配额**:本季已用 1 笔(DeskFox 品牌替换),本次后 **2/2(满)**;下次 override 必须等下季度

## 后续

- 阶段 B 实施完成后,在 `D:\project\deskfox-plugins\claude-code\NOTES.md` 写永久记录(plugin 侧也要知道 root cause + fix commit)
- **以后**(non-blocking):若上游对该 issue 启动修复(本 fork agent 可定期 check `git log upstream/dev -- packages/opencode/src/session/prompt.ts`),评估能否 cherry-pick 替换我们 fork 块
- **以后**:考虑给 sst/opencode 上提 issue / PR(轨道 1,本季搁置,下季视情)
