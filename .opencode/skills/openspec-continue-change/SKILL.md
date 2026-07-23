---
name: openspec-continue-change
description: 通过创建下一个产出物来继续处理 OpenSpec 变更。当用户想推进变更、创建下一个产出物或继续工作流时使用。
allowed-tools: Bash(openspec-cn:*)
license: MIT
compatibility: 需要 openspec-cn CLI。
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.6.0"
---

通过创建下一个产出物来继续处理变更。

**Store 选择：** 如果用户指定了某个 Store（Store 是在本机注册的独立 OpenSpec 仓库），或者工作位于某个 Store 中，请运行 `openspec-cn store list --json` 来查找已注册的 Store ID，然后在读写规范和变更的命令上传递 `--store <id>` 参数（`new change`、`status`、`instructions`、`list`、`show`、`validate`、`archive`、`doctor`、`context`）。其他命令不需要此参数。命令输出的提示信息中已包含该参数；请在后续操作中保留它。如果没有指定 Store，命令将对最近的本地 `openspec/` 根目录生效。

**输入**：可选地指定变更名。若省略，检查能否从对话上下文推断。若模糊或歧义，你必须提示用户从可用变更中选择。

**步骤**

1. **若未提供变更名，提示选择**

   运行 `openspec-cn list --json` 获取按最近修改排序的可用变更。然后使用 **AskUserQuestion tool** 让用户选择要处理的变更。

   展示最近修改的 3-4 个变更作为选项，显示：
   - 变更名
   - Schema（若有 `schema` 字段则用，否则 "spec-driven"）
   - 状态（例如 "0/5 任务"、"已完成"、"无任务"）
   - 最近修改时间（来自 `lastModified` 字段）

   将最近修改的变更标记为 "(推荐)"，因为这很可能是用户想继续的。

   **重要提示**：切勿猜测或自动选择变更。始终让用户选择。

2. **检查当前状态**
   ```bash
   openspec-cn status --change "<name>" --json
   ```
   解析 JSON 以理解当前状态。响应包括：
   - `schemaName`：使用的工作流 schema（例如 "spec-driven"）
   - `artifacts`：产出物数组及其状态（"done"、"ready"、"blocked"）
   - `isComplete`：指示所有产出物是否已完成的布尔值
   - `planningHome`、`changeRoot`、`artifactPaths` 和 `actionContext`：路径和范围上下文。使用这些而不是假设仓库本地路径。

3. **基于状态行动**：

   ---

   **若所有产出物已完成（`isComplete: true`）**：
   - 祝贺用户
   - 展示包含所用 schema 的最终状态
   - 建议："所有产出物已创建！你现在可以实现此变更或归档它。"
   - 停止

   ---

   **若产出物已就绪可创建**（状态显示有 `status: "ready"` 的产出物）：
   - 从状态输出中选取第一个 `status: "ready"` 的产出物
   - 获取其指令：
     ```bash
     openspec-cn instructions <artifact-id> --change "<name>" --json
     ```
   - 解析 JSON。关键字段：
     - `context`：项目背景（对你的约束 - 不要包含在输出中）
     - `rules`：产出物特定规则（对你的约束 - 不要包含在输出中）
     - `template`：用于输出文件的结构
     - `instruction`：Schema 特定指导
     - `resolvedOutputPath`：已解析的写入产出物的路径或模式
     - `dependencies`：已完成的产出物，用于读取上下文
   - **创建产出物文件**：
     - 读取任何已完成的依赖文件以获取上下文
     - 使用 `template` 作为结构 - 填充其各部分
     - 应用 `context` 和 `rules` 作为约束 - 但不要将它们复制到文件中
     - 写入指令中指定的 `resolvedOutputPath`。若是 glob 模式，使用 schema 指令和变更上下文选择具体文件路径
   - 展示创建了什么以及现在解锁了什么
   - 创建一个产出物后停止

   ---

   **若没有产出物就绪（全部受阻）**：
   - 这在有效 schema 中不应发生
   - 展示状态并建议检查问题

4. **创建产出物后，展示进度**
   ```bash
   openspec-cn status --change "<name>"
   ```

**输出**

每次调用后，展示：
- 创建了哪个产出物
- 使用的 schema 工作流
- 当前进度（N/M 已完成）
- 现在解锁了哪些产出物
- 提示："想继续吗？只要让我继续或告诉我接下来做什么。"

**产出物创建指南**

产出物类型及其用途取决于 schema。使用指令输出中的 `instruction` 字段理解要创建什么。

常见产出物模式：

**spec-driven schema**（proposal → specs → design → tasks）：
- **proposal.md**：若不清楚则询问用户关于变更的事。填写 Why、What Changes、Capabilities、Impact。
  - Capabilities 部分很关键 - 列出的每个能力都需要一个 spec 文件。
- **specs/<capability>/spec.md**：为 proposal 的 Capabilities 部分列出的每个能力创建一个 spec（使用能力名，而非变更名）。
- **design.md**：记录技术决策、架构和实现方法。
- **tasks.md**：将实现分解为带复选框的任务。

对于其他 schema，遵循 CLI 输出的 `instruction` 字段。

**护栏**
- 每次调用创建一个产出物
- 创建新产出物前始终阅读依赖产出物
- 不要跳过产出物或乱序创建
- 若上下文不清楚，创建前询问用户
- 写入后验证产出物文件存在再标记进度
- 使用 schema 的产出物序列，不要假设具体产出物名
- **重要提示**：`context` 和 `rules` 是对你的约束，而不是文件内容
  - 不要将 `<context>`、`<rules>`、`<project_context>` 块复制到产出物中
  - 这些引导你编写内容，但不应出现在输出中
