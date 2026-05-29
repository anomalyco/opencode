# System Prompt 缓存稳定性优化

## 目标

消除 opencode system prompt 在 session 生命周期内的非确定性变化，最大化 DeepSeek 前缀缓存命中率。

## 背景

DeepSeek LLM Server 采用前缀匹配方式管理 KV cache，缓存可在全局池中保留数小时至数天。
**关键发现**：DeepSeek 将 `tools` 定义拼接在 system prompt 之后做 prefix cache。
system prompt 每字节变化都会导致其后所有 tools 定义的缓存全部失效，
而 tools 的定义体量通常比 system prompt 本身大数倍。

## System Prompt 组装流程

```
runLoop (prompt.ts:1244)
  └─ while(true) — 每个 tool-call round-trip 执行一次
       └─ 1435-1441: 重新构建 system 数组
            ├─ sys.environment(model)        → env 信息
            ├─ instruction.system()          → AGENTS.md / CLAUDE.md / instructions / URL
            └─ sys.skills(agent)             → skills 描述
       └─ 1450: 传入 handle.process() → LLM.stream()
            └─ LLMRequestPrep.prepare (llm/request.ts:56)
                 ├─ agent.prompt || SystemPrompt.provider(model)  [基础模板]
                 ├─ ...input.system                                [动态层]
                 └─ input.user.system                              [用户层]
```

最终拼接为单一 system message（`request.ts:56-63`）。

## 已实施的修改

共 **4 个文件**，未提交。

### 改动 1：env_info 改为静态指令（`system.ts`）

**文件**: `packages/opencode/src/session/system.ts`

将所有动态内容改为告诉 agent 如何自行获取的静态指令文本：

```diff
-  Working directory: ${ctx.directory}
+  Working directory: if needed, run command `pwd`

-  Workspace root folder: ${ctx.worktree}
+  Git workspace root folder: if needed, run command `git rev-parse --show-toplevel`

-  Is directory a git repo: ${...}
+  Is directory a git repo: if needed, run command `git rev-parse --is-inside-work-tree`

-  Today's date: ${new Date().toDateString()}
+  Today's date: if needed, run command `date`
```

保留项：

| 保留字段 | 稳定性 |
|----------|:------:|
| model.api.id + providerID | 同 model 时稳定 |
| Platform (process.platform) | 始终稳定 |

### 改动 2：移除 instructions 输出（`prompt.ts`）

**文件**: `packages/opencode/src/session/prompt.ts`

`...instructions` 从 system 数组展开中移除，AGENTS.md / CLAUDE.md / config.instructions 不再进入 system prompt。

```diff
- const system = [...env, ...instructions, ...(skills ? [skills] : [])]
+ const system = [...env, ...(skills ? [skills] : [])]
```

`Instruction` 模块及所有调用方完全未动，仅不将结果拼入 system prompt。

### 改动 3：修复 built-in skill 的 location 展示（`skill/index.ts`）

**文件**: `packages/opencode/src/skill/index.ts`

built-in skill 的 `location` 值为 `"<built-in>"`，但 `pathToFileURL()` 将其视为相对路径拼接到 `process.cwd()`，
产生的 `file:///cwd/%3Cbuilt-in%3E` 会随 working directory 变化，破坏 system prompt 中的 skills 段。

```diff
- `<location>${pathToFileURL(skill.location).href}</location>`,
+ `<location>${skill.location === "<built-in>" ? skill.location : pathToFileURL(skill.location).href}</location>`,
```

### 改动 4：修复 built-in skill 工具执行（`tool/skill.ts`）

**文件**: `packages/opencode/src/tool/skill.ts`

当加载 built-in skill 时，`path.dirname("<built-in>")` 返回 `"."`，导致 `rg.files({ cwd: "." })` 在用户工作目录搜索文件，
显示错误的 base directory。

增加 `builtin` 变量，对 built-in skill 跳过 `rg.files` 和路径解析：

```ts
const builtin = info.location === "<built-in>"
const dir = builtin ? "" : path.dirname(info.location)
const base = builtin ? info.location : pathToFileURL(dir).href
const files = builtin ? "" : yield* rg.files(...)
```

---

## 收益

### 缓存稳定性

| 组件 | 优化前 | 优化后 |
|------|:----:|:------:|
| env_info | 动态值（workdir, git, date） | 静态文本指令 |
| instructions | 文件/URL 内容（非确定性） | 从 system prompt 中排除 |
| skills built-in location | `file:///cwd/%3Cbuilt-in%3E` | `<built-in>` |
| system prompt 全量 | 随目录/git/日期变化 | **完全静态** |

### DeepSeek 前缀缓存效果

```
优化前: [base_template] [env(含workdir)] [instructions] [skills(含错误location)] ...[tools]
         ↑ cache hit       ↑ ALL MISS (1k hit / 11k total)

优化后: [base_template] [env(静态)] [skills(静态)] ...[tools]
         ↑ 全量 cache hit (10k+ hit)
```

---

## 设计决策

1. **env 不做删除而改写为指令**：保留 agent 获取上下文的能力，但将成本从 cache miss 转移到一次性的 tool call。
2. **不修改 `instruction.ts`**：保留 `instruction.system()` 调用及 I/O 开销，仅不将结果拼入 system prompt。最小化 diff。
3. **保留 `instruction.resolve()`**：Read 工具输出中仍可注入附近 AGENTS.md（在 conversation 位置，不影响 system prompt 前缀缓存）。
4. **built-in skill 严格匹配 `"<built-in>"`**：不使用 `startsWith("<")` 等模糊判断。

---

## 遗留问题

### 1. `experimental.chat.system.transform` 插件 hook

**位置**: `session/llm/request.ts:67-71` — 插件可修改 system prompt，破坏稳定性。**本轮暂不处理。**

### 2. Skills 文件在 session 生命周期内的变化

Skills 列表从磁盘读取，运行时变化会导致 system prompt 前缀变化。**本轮暂不处理。**

### 3. `experimental.chat.messages.transform` 间接影响

**位置**: `prompt.ts:1433` — 插件可修改消息列表。**本轮暂不处理。**

---

## 改动总览

| # | 文件 | 改动 |
|---|------|------|
| 1 | `system.ts:55-62` | env 字段从动态值改为静态指令文本 |
| 2 | `prompt.ts:1441` | 移除 `...instructions`，排除 AGENTS.md 等内容 |
| 3 | `skill/index.ts:338` | built-in skill 的 location 不用 `pathToFileURL` |
| 4 | `tool/skill.ts:36-69` | built-in skill 跳过 `rg.files` + 路径解析 |

**分支**: `fix/system-prompt-cache-stability`
**状态**: 未提交（本地修改中）
