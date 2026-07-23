---
name: openspec-onboard
description: OpenSpec 引导式入门 - 通过讲解和真实代码库工作走完一个完整的工作流周期。
allowed-tools: Bash(openspec-cn:*)
license: MIT
compatibility: 需要 openspec-cn CLI。
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.6.0"
---

引导用户完成他们的第一个完整 OpenSpec 工作流周期。这是一次教学体验——你将在他们的代码库中做真实工作，同时解释每一步。

**Store 选择：** 如果用户指定了某个 Store（Store 是在本机注册的独立 OpenSpec 仓库），或者工作位于某个 Store 中，请运行 `openspec-cn store list --json` 来查找已注册的 Store ID，然后在读写规范和变更的命令上传递 `--store <id>` 参数（`new change`、`status`、`instructions`、`list`、`show`、`validate`、`archive`、`doctor`、`context`）。其他命令不需要此参数。命令输出的提示信息中已包含该参数；请在后续操作中保留它。如果没有指定 Store，命令将对最近的本地 `openspec/` 根目录生效。

---

## 预检

开始前，检查 OpenSpec CLI 是否已安装：

```bash
# Unix/macOS
openspec-cn --version 2>&1 || echo "CLI_NOT_INSTALLED"
# Windows (PowerShell)
# if (Get-Command openspec-cn -ErrorAction SilentlyContinue) { openspec-cn --version } else { echo "CLI_NOT_INSTALLED" }
```

**若 CLI 未安装：**
> OpenSpec CLI 未安装。先安装它，然后回到 `/opsx:onboard`。

若未安装则在此停止。

---

## 阶段 1：欢迎

展示：

```
## 欢迎使用 OpenSpec！

我将带你走完一个完整的变更周期——从想法到实现——使用你代码库中的真实任务。在此过程中，你将通过实践学习工作流。

**我们将做什么：**
1. 在你的代码库中选一个小而真实的任务
2. 简要探索问题
3. 创建一个变更（我们工作的容器）
4. 构建产出物：proposal → specs → design → tasks
5. 实现任务
6. 归档已完成的变更

**时间：** 约 15-20 分钟

让我们从找点事做开始。
```

---

## 阶段 2：任务选择

### 代码库分析

扫描代码库寻找小的改进机会。寻找：

1. **TODO/FIXME 注释** - 在代码文件中搜索 `TODO`、`FIXME`、`HACK`、`XXX`
2. **缺失的错误处理** - 吞掉错误的 `catch` 块、没有 try-catch 的危险操作
3. **没有测试的函数** - 交叉引用 `src/` 与测试目录
4. **类型问题** - TypeScript 文件中的 `any` 类型（`: any`、`as any`）
5. **调试残留** - 非调试代码中的 `console.log`、`console.debug`、`debugger` 语句
6. **缺失的验证** - 没有验证的用户输入处理器

也检查最近的 git 活动：
```bash
# Unix/macOS
git log --oneline -10 2>/dev/null || echo "No git history"
# Windows (PowerShell)
# git log --oneline -10 2>$null; if ($LASTEXITCODE -ne 0) { echo "No git history" }
```

### 展示建议

从你的分析中，展示 3-4 个具体建议：

```
## 任务建议

基于扫描你的代码库，这里有一些不错的入门任务：

**1. [最有潜力的任务]**
   位置：`src/path/to/file.ts:42`
   范围：约 1-2 个文件，约 20-30 行
   为什么好：[简要原因]

**2. [第二个任务]**
   位置：`src/another/file.ts`
   范围：约 1 个文件，约 15 行
   为什么好：[简要原因]

**3. [第三个任务]**
   位置：[位置]
   范围：[估计]
   为什么好：[简要原因]

**4. 其他？**
   告诉我你想做什么。

哪个任务感兴趣？（选一个数字或描述你自己的）
```

**若什么都没找到：** 回退到询问用户想构建什么：
> 我没有在你的代码库中找到明显的速胜点。有什么你一直想添加或修复的小东西吗？

### 范围护栏

若用户选择或描述的东西太大（主要功能、多天工作）：

```
那是一个有价值的任务，但对于你的第一次 OpenSpec 体验来说可能比理想的要大。

为了学习工作流，越小越好——它能让你看到完整周期而不会陷入实现细节。

**选项：**
1. **切分得更小** - [他们的任务]中最小有用的部分是什么？也许只是 [具体切片]？
2. **选别的** - 其他建议之一，或不同的小任务？
3. **就做这个** - 如果你真的想处理这个，可以。只是知道会花更长时间。

你更倾向于哪个？
```

若用户坚持则让他们覆盖——这是软护栏。

---

## 阶段 3：探索演示

一旦选定了任务，简要演示探索模式：

```
在创建变更前，让我快速给你展示 **探索模式**——这是在承诺一个方向之前思考问题的方式。
```

花 1-2 分钟调查相关代码：
- 阅读涉及的文件
- 如果有帮助，画一个简单的 ASCII 图
- 记录任何注意事项

```
## 快速探索

[你的简要分析——你发现了什么，任何注意事项]

┌─────────────────────────────────────────┐
│   [可选：有帮助的 ASCII 图]            │
└─────────────────────────────────────────┘

探索模式（`/opsx:explore`）就是用于这种思考——在实现之前调查。你可以在需要思考问题时随时使用它。

现在让我们创建一个变更来承载我们的工作。
```

**暂停** - 等待用户确认后再继续。

---

## 阶段 4：创建变更

**解释：**
```
## 创建变更

OpenSpec 中的 "变更" 是围绕一项工作所有思考和规划的容器。它位于 `openspec-cn status --change "<name>" --json` 报告的 `changeRoot`，承载你的产出物——proposal、specs、design、tasks。

让我为我们的任务创建一个。
```

**做：** 用推导的 kebab-case 名称创建变更：
```bash
openspec-cn new change "<derived-name>"
```

**展示：**
```
已创建：<changeRoot from status JSON>

文件夹结构：
```
<changeRoot>/
├── proposal.md    ← 我们为什么做这个（空的，我们将填充）
├── design.md      ← 我们怎么构建（空的）
├── specs/         ← 详细需求（空的）
└── tasks.md       ← 实现清单（空的）
```

现在让我们填写第一个产出物——proposal。
```

---

## 阶段 5：Proposal

**解释：**
```
## Proposal

Proposal 捕获我们**为什么**做这个变更以及高层面上涉及**什么**。它是工作的"电梯演讲"。

我将基于我们的任务起草一个。
```

**做：** 起草 proposal 内容（先不保存）：

```
这是草稿 proposal：

---

## Why

[1-2 句话解释问题/机会]

## What Changes

[什么将不同的要点]

## Capabilities

### New Capabilities
- `<capability-name>`: [简要描述]

### Modified Capabilities
<!-- 若修改现有行为 -->

## Impact

- `src/path/to/file.ts`: [什么变化]
- [其他文件（如适用）]

---

这捕捉了意图吗？我可以在保存前调整。
```

**暂停** - 等待用户批准/反馈。

批准后，保存 proposal：
```bash
openspec-cn instructions proposal --change "<name>" --json
```
然后将内容写入 `openspec-cn instructions proposal --change "<name>" --json` 的 `resolvedOutputPath`。

```
Proposal 已保存。这是你的 "为什么" 文档——你可以随时回来随着理解演进完善它。

接下来：specs。
```

---

## 阶段 6：Specs

**解释：**
```
## Specs

Specs 以精确、可测试的术语定义我们正在构建**什么**。它们使用需求/场景格式，使预期行为清晰明了。

对于这样的小任务，我们可能只需要一个 spec 文件。
```

**做：** 解析 spec 文件应创建到哪里：
```bash
openspec-cn instructions specs --change "<name>" --json
# 使用 JSON 中的 resolvedOutputPath。若是 glob，使用 schema 指令和变更上下文选择具体文件路径。
```

起草 spec 内容：

```
这是 spec：

---

## ADDED Requirements

### Requirement: <Name>

<系统应做什么的描述>

#### Scenario: <场景名>

- **WHEN** <触发条件>
- **THEN** <预期结果>
- **AND** <如有其他结果>

---

这种格式——WHEN/THEN/AND——使需求可测试。你简直可以把它们当作测试用例来读。
```

保存到从 `resolvedOutputPath` 选择的具体文件路径。

---

## 阶段 7：Design

**解释：**
```
## Design

Design 捕获我们**怎么**构建它——技术决策、权衡、方法。

对于小变更，这可能很简短。那没关系——不是每个变更都需要深入的设计讨论。
```

**做：** 起草 design.md：

```
这是 design：

---

## Context

[关于当前状态的简要上下文]

## Goals / Non-Goals

**Goals:**
- [我们想实现的]

**Non-Goals:**
- [明确不在范围内的]

## Decisions

### Decision 1: [关键决策]

[方法和理由的解释]

---

对于小任务，这捕获了关键决策而没有过度设计。
```

保存到 `openspec-cn instructions design --change "<name>" --json` 的 `resolvedOutputPath`。

---

## 阶段 8：Tasks

**解释：**
```
## Tasks

最后，我们将工作分解为实现任务——驱动 apply 阶段的复选框。

这些应该小、清晰、逻辑顺序合理。
```

**做：** 基于 specs 和 design 生成 tasks：

```
这是实现任务：

---

## 1. [类别或文件]

- [ ] 1.1 [具体任务]
- [ ] 1.2 [具体任务]

## 2. 验证

- [ ] 2.1 [验证步骤]

---

每个复选框成为 apply 阶段的工作单元。准备好实现了吗？
```

**暂停** - 等待用户确认他们准备好实现。

保存到 `openspec-cn instructions tasks --change "<name>" --json` 的 `resolvedOutputPath`。

---

## 阶段 9：Apply（实现）

**解释：**
```
## 实现

现在我们实现每个任务，边做边勾选。我将宣布每个任务并偶尔说明 specs/design 如何影响了方法。
```

**做：** 对每个任务：

1. 宣布："正在处理任务 N：[描述]"
2. 在代码库中实现变更
3. 自然地引用 specs/design："Spec 说 X，所以我做 Y"
4. 在 tasks.md 中标记完成：`- [ ]` → `- [x]`
5. 简要状态："✓ 任务 N 完成"

保持讲解轻松——不要过度解释每一行代码。

所有任务后：

```
## 实现完成

所有任务完成：
- [x] 任务 1
- [x] 任务 2
- [x] ...

变更已实现！还有一步——让我们归档它。
```

---

## 阶段 10：归档

**解释：**
```
## 归档

变更完成后，我们归档它。归档路径从 `planningHome.changesDir` 和日期派生。

归档的变更成为你项目的决策历史——你随时可以稍后找到它们以理解某东西为什么那样构建。
```

**做：**
```bash
openspec-cn archive "<name>"
```

**展示：**
```
已归档到：`<planningHome.changesDir>/archive/YYYY-MM-DD-<name>/`

变更现在是你项目历史的一部分。代码在你的代码库中，决策记录已保存。
```

---

## 阶段 11：回顾与下一步

```
## 恭喜！

你刚完成了一个完整的 OpenSpec 周期：

1. **Explore** - 思考问题
2. **New** - 创建变更容器
3. **Proposal** - 捕获为什么
4. **Specs** - 详细定义什么
5. **Design** - 决定怎么做
6. **Tasks** - 分解为步骤
7. **Apply** - 实现工作
8. **Archive** - 保存记录

同样的节奏适用于任何大小的变更——小修复或主要功能。

---

## 命令参考

**核心工作流：**

 | 命令              | 作用                               |
 |-------------------|--------------------------------------------|
 | `/opsx:propose` | 创建变更并生成所有产出物 |
 | `/opsx:explore` | 在工作前/期间思考问题  |
 | `/opsx:apply`   | 从变更中实现任务              |
 | `/opsx:archive` | 归档已完成的变更                 |

**其他命令：**

 | 命令               | 作用                                             |
 |--------------------|----------------------------------------------------------|
 | `/opsx:new`      | 启动新变更，一次一个产出物 |
 | `/opsx:continue` | 继续处理现有变更                   |
 | `/opsx:ff`       | 快进：一次性创建所有产出物               |
 | `/opsx:verify`   | 验证实现是否匹配产出物                  |

---

## 接下来？

在你真正想构建的东西上试试 `/opsx:propose`。你现在已经有节奏了！
```

---

## 优雅退出处理

### 用户想中途停止

若用户说需要停止、想暂停或似乎不投入：

```
没问题！你的变更保存在 `openspec-cn status --change "<name>" --json` 报告的 `changeRoot`。

稍后从我们离开的地方继续：
- `/opsx:continue <name>` - 恢复产出物创建
- `/opsx:apply <name>` - 跳到实现（若存在任务）

工作不会丢失。随时回来。
```

优雅退出，不要施压。

### 用户只想看命令参考

若用户说只想看命令或跳过教程：

```
## OpenSpec 快速参考

**核心工作流：**

 | 命令                     | 作用                               |
 |--------------------------|--------------------------------------------|
 | `/opsx:propose <name>` | 创建变更并生成所有产出物 |
 | `/opsx:explore`        | 思考问题（不更改代码）   |
 | `/opsx:apply <name>`   | 实现任务                            |
 | `/opsx:archive <name>` | 完成后归档                          |

**其他命令：**

 | 命令                      | 作用                        |
 |---------------------------|-------------------------------------|
 | `/opsx:new <name>`      | 启动新变更，逐步    |
 | `/opsx:continue <name>` | 继续现有变更         |
 | `/opsx:ff <name>`       | 快进：所有产出物一次性 |
 | `/opsx:verify <name>`   | 验证实现               |

试试 `/opsx:propose` 启动你的第一个变更。
```

优雅退出。

---

## 护栏

- **在关键转换处遵循 解释 → 做 → 展示 → 暂停 模式**（探索后、proposal 草稿后、tasks 后、归档后）
- **实现期间讲解保持轻松**——教导而不说教
- **不要跳过阶段**，即使变更很小——目标是教授工作流
- **在标记点暂停**等待确认，但不要过度暂停
- **优雅处理退出**——绝不施压用户继续
- **使用真实代码库任务**——不要模拟或使用虚假示例
- **温和调整范围**——引导向更小任务但尊重用户选择
