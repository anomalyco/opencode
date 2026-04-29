---
feat-id: plugin-cwd-channel
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# plugin-cwd-channel — changelog

## 一句话

给 opencode 加 `providerOptions._opencode` 通用 namespace 暴露 session 工作目录(`cwd` + `project`),让 spawn-based LanguageModelV2 plugin(claude-code 等)能拿到 user 在 UI 选定的项目目录。R4 第 3 笔(本季 user 特批,不扣下季度配额)。

## commit 列表

| commit | 简述 |
|---|---|
| `41817499d` | `fix(opencode): 加 _opencode providerOptions namespace 暴露 cwd 给 spawn-based plugin [feat: plugin-cwd-channel] [override-blacklist: spawn-based plugin 协议增量,plugin 单独修不了,本季第 3 笔特批]` |

## 改动文件

| 文件 | 变更 | 备注 |
|---|---|---|
| `packages/opencode/src/session/llm.ts` | +12 行 / -1 行 FORK 块 | line 363 把 `Instance.directory` + `Instance.project.id` 注入 providerOptions._opencode namespace,前后 FORK-BEGIN/END marker;原 `ProviderTransform.providerOptions(...)` 完全保留作 spread base |
| `docs/features/plugin-cwd-channel/1-spec.md` | 新增 | spec(R4 复核报告完整) |
| `docs/features/plugin-cwd-channel/2-plan.md` | 新增 | plan(决策轨迹 + R4 复核三项) |
| `docs/features/plugin-cwd-channel/3-changelog.md` | 新增 | 本文 |
| `docs/features/INDEX.md` | +1 行 | feature 索引 |
| `本仓 改动日志.md` | +1 行 | feature 索引 |

## 起因

claude-code-loop-fix 收尾后给 user 演示打 prod 安装包发其他人,user 在 DeskFox 选项目 "Kbase"(`D:\Kbase`)发"现在在哪个项目里",Claude 回:`当前工作目录是 D:\softwares\DeskFox`(installer 安装目录),完全没看到 user 选的 Kbase 项目。

### 排查链

1. ❌ **猜 1**:plugin spawn claude.exe 时 cwd 不对 → 看 `claude-code-language-model.ts:137 const cwd = this.config.cwd ?? process.cwd()` → `process.cwd()` = sidecar 启动目录 = installer dir → **现象坐实**
2. ❌ **猜 2**:DeskFox UI 没把项目目录传到 sidecar → 看 `Instance.directory` 已是动态字段(prompt.ts 多处用,如 line 823) → 不是这层
3. ✅ **决定性确认**:opencode `llm.ts:363 providerOptions = ProviderTransform.providerOptions(input.model, params.options)` 只走 user 静态配置,**没把** `Instance.directory` 注入 providerOptions

**根因坐实**:opencode 的 `Instance.directory` 没透传到 ai-sdk providerOptions,plugin 即使想接也拿不到。链路缺失在 opencode 主程,**plugin 单独修不了**。

### 共有问题判断

| plugin 类型 | 例子 | 是否需要 cwd | 受影响? |
|---|---|---|---|
| standard LanguageModelV2(纯 HTTP API)| OpenAI/Anthropic/qwen3/MiniMax/GetBot | ❌ 不需要 | 不受影响 |
| spawn-based plugin(包装 CLI 子进程)| claude-code、(将来)codex CLI / gemini CLI / aider | ✅ 必须 | **全都受影响** |

是 spawn-based plugin 子类的**共有问题**(不是 LanguageModelV2 通用问题)。

## 修法

### 选型:`_opencode` 通用 namespace(future-proof)

`packages/opencode/src/session/llm.ts:363` 改前:

```ts
providerOptions: ProviderTransform.providerOptions(input.model, params.options),
```

改后:

```ts
// FORK-BEGIN: plugin-cwd-channel — 把 session 工作目录暴露给 spawn-based plugin
// 通用 _opencode namespace 设计:任何 spawn-based plugin(claude-code/codex/gemini/aider)
// 都能从 options.providerOptions._opencode.cwd 取项目目录,无需 plugin 各自定义协议
// 详见 docs/features/plugin-cwd-channel/3-changelog.md
providerOptions: {
  ...ProviderTransform.providerOptions(input.model, params.options),
  _opencode: {
    cwd: Instance.directory,
    project: Instance.project.id,
  },
},
// FORK-END
```

### 关键设计

- **`_opencode` 下划线前缀 namespace**:约定俗成"opencode 内部",不与 ai-sdk 已知 provider key(`anthropic` / `openai` / `google` 等)冲突
- **同时暴露 cwd + project ID**:cwd 是 user 选的项目目录(spawn 子进程要用);project ID 给 plugin 做 session 隔离 key(claude-code plugin 内部 sessionKey 已有 cwd 拼接,加 project 更稳)
- **`Instance.directory` 已 import**(`packages/opencode/src/session/llm.ts:10 import { Instance } from "@/project/instance"`,line 372 `Instance.project.id` 已用),无需改 import / StreamInput type / 调用方
- **standard provider 0 影响**:他们不消费 `_opencode` namespace,无副作用
- **前置 spread,不替换原 providerOptions**:`...ProviderTransform.providerOptions(...)` 保留全部 user 配置 + 我们 namespace,可单独 revert

## 验证

| 项 | 期望 | 实测 |
|---|---|---|
| typecheck | `bun run --cwd packages/opencode typecheck` 无错 | ✅ tsgo --noEmit 通过 |
| FORK marker | line 范围内 FORK-BEGIN / FORK-END 各 1 个 | ✅ |
| 现有 break 行为 | claude-code-loop-fix case-1 兜底仍命中 | ✅(改动只加 namespace,不影响 break 决策路径) |
| standard provider | 名 namespace 隔离不破 OpenAI/Anthropic/qwen3 等 | 🟡 静态可推理(他们不读 `_opencode`),实战待 user 验 |
| **end-to-end cwd 修复** | DeskFox 选 X 项目 → Claude 回项目 X | 🟡 **等 plugin 端 ~1 行 fallback 接住后才能完整验** — 见 HANDOFF-2 |

## R4 override 配额

- 改动规则.md 黑名单:`packages/opencode/`(明文"绝对不动")
- override commit message tag:`[override-blacklist: spawn-based plugin 协议增量,plugin 单独修不了,本季第 3 笔特批]`
- **季度配额**:**本次为本季第 3 笔(超阈值 2/2),user 特批,下季度配额不预扣仍 2 笔**
- **健康指标记录**:本季 override = 3 / 阈值 2(超 1 笔,特批)

### R4 复核报告(详 [2-plan.md](./2-plan.md))

- ① wrapper 不可行性:plugin/desktop/ai-sdk-patch/monkey-patch/配置化/env-var **全不可行**,R1 第 3 级唯一可行
- ② 风险评估:**低**(单文件,namespace 隔离,可独立 revert,standard provider 0 影响)
- ③ 改动日志论证:单文件 +12 行 / -1 行,前置 spread 不替换原代码,可单独 git revert

## 影响范围

- **代码**:`packages/opencode/src/session/llm.ts` 单一文件 +11 行净增 fork-only;原 providerOptions 完全保留作 spread base
- **运行时**:
  - **claude-code plugin 用户**:协议端就绪;等 plugin 端 fallback 后修复 cwd bug ✓
  - **未来 spawn-based plugin**(codex/gemini/aider):普惠基础设施 ✓(零增量接入)
  - **standard provider**(openai/anthropic/google/GetBot/qwen3/MiniMax 等):**0 影响**(namespace 隔离 + 他们不消费 `_opencode` 字段)
  - **sst/opencode 主线**:不变(纯 fork-only 增量)
- **build / runtime 性能**:0 影响(只多个 obj literal 字段)
- **上游侵入率**:`packages/opencode/` 第 2 个改动文件(claude-code-loop-fix `prompt.ts` 是第 1 个),季度 health check 重点关注

## 回退方法

```bash
# 完全回退
git revert <commit-hash>

# 或手工删 FORK 块(12 行)
# 找 packages/opencode/src/session/llm.ts 的 // FORK-BEGIN: plugin-cwd-channel
# 到 // FORK-END,整段删,保留原 providerOptions: ProviderTransform.providerOptions(...) 一行
```

## 走过的弯路 / 中途调整

1. **决定要不要等下季度**:user 提出"看下其他 plugin 是否共有问题"后,确认是 spawn-based plugin 子类共性问题(future codex/gemini/aider 都受影响)。user 决定本季 R4 第 3 笔特批,**不扣下季度配额**(平均仍 2 笔/季)。
2. **namespace 选型**:最初想 `claude-code` 专属 namespace,但意识到这是 spawn-based 子类共性问题,改成 `_opencode` 通用 namespace。future-proof 意义大。
3. **是否改 StreamInput type**:最初想加 `directory: string` 字段,但发现 `Instance.directory` 已 import 在 llm.ts:10 + line 372 已用 `Instance.project.id`,直接复用即可,**无需改 StreamInput / 所有调用方**。

## 后续(留作 future)

- **plugin 端 fallback**:已写 HANDOFF-2(本仓 `HANDOFF-to-plugin-2026-04-29-cwd.md`)给 plugin agent;`claude-code-language-model.ts:137` 加 `options.providerOptions?._opencode?.cwd ?? this.config.cwd ?? process.cwd()`,~1 行无害
- **季度 health check**:关注上游 sst/opencode 是否新增同位置 cwd 注入(若有,删 FORK 块替换主线)
- **ai-sdk 升级监控**:类似 task #13 (usage schema 升级),如 ai-sdk 改 providerOptions schema,同步调整 namespace 风格
- **future spawn-based plugin**:codex CLI / gemini CLI / aider 等接入时直接读 `_opencode.cwd` 即可,**零 opencode 端增量**

## 经验沉淀

| 启示 | 落实位置 |
|---|---|
| spawn-based plugin 是 LanguageModelV2 的"包装 CLI"子类,需要文件系统 cwd 概念 | 本文 + opencode-fork 治理认知 |
| 协议增量优先用 namespace 而非顶级字段(future-proof) | 本文 + 后续协议增量沿用 |
| `Instance.directory` 是 opencode 现成的 session 工作目录字段,优先复用 | 本文 |
| 跨仓修复(opencode + plugin)时,opencode 端先就绪是基础设施;plugin 端 1 行 fallback 是接入 | 本文 + HANDOFF-2 |
| R4 配额满时,user 特批后续做"超阈值"修但**不扣下季度** —— 健康指标记 3/2 但年度合计仍合规 | 本季 R4 政策记录 |
