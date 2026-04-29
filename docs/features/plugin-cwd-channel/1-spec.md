---
feat-id: plugin-cwd-channel
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# plugin-cwd-channel — spec

> **⚠️ R4 override 复核已通过(本季第 3 笔,user 特批不扣下季度配额)**

## 一句话

给 opencode 加一个 `providerOptions._opencode.cwd` 通用通道,把 session 工作目录暴露给 spawn-based LanguageModelV2 plugin(如 claude-code、codex CLI、gemini CLI、aider),修复 user 切项目时 Claude 不知道当前项目目录的链路缺失。

## 触发原因

### 现象(claude-code 场景为例)

DeskFox(installer 装的)选 "Kbase" 项目(`D:\Kbase`),发"现在在哪个项目里",Claude 回:`当前工作目录是 D:\softwares\DeskFox`(installer 安装目录),完全没看到 user 选定的 Kbase。

### 根因诊断

数据流:
```
DeskFox UI 选 "Kbase"
   ↓
opencode session.ctx.directory = "D:\Kbase"   ✅ 已在 ctx 里(Instance.directory)
   ↓
opencode 调 ai-sdk streamText
   ↓ providerOptions = ProviderTransform.providerOptions(input.model, params.options)
   ↓ ↑↑↑【没把 ctx.directory 注入】
   ↓
plugin.doStream(options)
   ↓ plugin: options.providerOptions?.["claude-code"]?.cwd ?? this.config.cwd ?? process.cwd()
   ↑↑↑ 拿不到,fallback process.cwd() = installer dir / sidecar 启动目录
   ↓
spawn claude.exe --cwd <错误的目录> → Claude 看错项目
```

**核心缺口**:opencode 的 `Instance.directory` 没有透传到 ai-sdk providerOptions,plugin 拿不到 user 选的项目目录。

### 上游已知状态(2026-04-29 核实)

- `sst/opencode dev` 同位置(`packages/opencode/src/session/llm.ts:363`)同款 — 上游**未做** spawn-based plugin 适配
- 上游 plugin 体系主要是 standard LanguageModelV2(纯 HTTP API,不需 cwd),没动 spawn-based 路径
- 我们 fork 主用 claude-code 这种 spawn-based plugin,需要主动加这条协议

### 为啥 plugin 单独修走不通(R1 三级跳)

- plugin 拿不到 `Instance.directory`(opencode 内部 ctx 字段不暴露给外部)
- 不能通过 env vars / lock file / 启动 cwd 等绕路(opencode 切项目时不重启 sidecar,sidecar 进程 cwd 是固定的)
- desktop 壳只起 sidecar,不参与 session 决策,无法拦
- 不能 patch ai-sdk(它只是透传 providerOptions,改它没意义)
- **必须在 opencode 主程注入,plugin 配合接** — R1 第 3 级唯一可行

## 验收标准

1. **claude-code plugin cwd 正确**:DeskFox 选项目 X → 发"在哪个项目" → Claude 回项目 X(待 plugin 端 ~1 行 fallback 跟进后才能验)
2. **standard provider 不受影响**:OpenAI / Anthropic / GetBot / qwen3 / MiniMax 等正常对话不破
3. **typecheck 通过**:`bun run --cwd packages/opencode typecheck` 无错
4. **release build 通过**:`build-deskfox.ps1 -Env dev -NoBundle` 出 DeskFox.exe
5. **核心 break 行为不退化**:claude-code-loop-fix 的 case-1 兜底仍命中(loop 不卡死)

## 不做什么

- 不改 plugin 端(归 plugin 仓 plugin agent;本仓只做 opencode 注入)
- 不为 claude-code **专属** namespace(用通用 `_opencode` namespace,future-proof)
- 不解 task #12 (plugin "no user content" 平行切面 — 留下季度若再开 R4)

## 架构选型

### 路径分析

| 路径 | 选 | 理由 |
|---|---|---|
| **A. 用 _opencode 通用 namespace** | ✅ | future-proof — 任何 spawn-based plugin(codex/gemini/aider 等)零增量接入 |
| B. 用 claude-code 专属 namespace | ❌ | 每个 plugin 都要 opencode 加 namespace,过度耦合 |
| C. 改 ai-sdk 协议(加顶级 cwd 字段) | ❌ | ai-sdk 不该有文件系统概念;它是抽象 LLM 接口 |
| D. 加 StreamInput 字段后调用方传 | ❌ | 改 StreamInput type + 所有调用方,侵入性大;`Instance.directory` 已是全局,直接用即可 |
| E. patch-package ai-sdk | ❌ | 上游依赖打补丁机制,等价改上游,且 ai-sdk 不在我们仓内 |

### 选定:A(`_opencode` 通用 namespace)

```ts
// packages/opencode/src/session/llm.ts:363 改前
providerOptions: ProviderTransform.providerOptions(input.model, params.options),

// 改后
providerOptions: {
  ...ProviderTransform.providerOptions(input.model, params.options),
  _opencode: {
    cwd: Instance.directory,
    project: Instance.project.id,
  },
},
```

**关键设计**:
- **下划线 `_opencode` 前缀**:约定俗成"opencode 内部 namespace",不与 ai-sdk 已知 provider key 冲突
- **暴露 cwd + project**:cwd 是项目目录,project 是 session/project ID(plugin 可用作 session 隔离 key)
- **不 break standard provider**:他们不消费 `_opencode` namespace,无副作用
- **Instance.directory 已是 import**(line 10),无需改 StreamInput / 调用方

## R4 复核报告

详见 [2-plan.md](./2-plan.md) 末尾"R4 复核"段。三项已论证:wrapper 不可行性 / 风险评估(总体低)/ 改动日志论证(单文件 +12 行)。

**配额政策**(本次特批):
- 本季度 R4 = 3/2(超阈值,user 特批)
- 下季度 R4 配额 = 2(**不**预扣,user 决定)

## 后续

- **plugin 端配合**:`claude-code-language-model.ts:137` 加 fallback `options.providerOptions?._opencode?.cwd` — ~1 行,无害,归 plugin agent
- **未来 spawn-based plugin**(codex / gemini / aider 等):接入时只要在 doStream 读 `_opencode.cwd` 即可,无需 opencode 端再增量
- **季度 health check**:关注 ai-sdk 升级是否影响 providerOptions schema(类似 task #13 的 inputTokens 升级)
