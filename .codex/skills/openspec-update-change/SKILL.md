---
name: openspec-update-change
description: 更新 OpenSpec 变更——修订其现有规划制品并使其保持相互一致。当用户想要修订变更的计划、将新决策纳入其中，或在编辑后调和其制品时使用。永不编辑代码。
allowed-tools: Bash(openspec-cn:*)
license: MIT
compatibility: 需要 openspec-cn CLI。
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.6.0"
---

修订变更的现有规划制品并使其保持相互一致。永不编辑代码。

**Store 选择：** 如果用户指定了某个 Store（Store 是在本机注册的独立 OpenSpec 仓库），或者工作位于某个 Store 中，请运行 `openspec-cn store list --json` 来查找已注册的 Store ID，然后在读写规范和变更的命令上传递 `--store <id>` 参数（`new change`、`status`、`instructions`、`list`、`show`、`validate`、`archive`、`doctor`、`context`）。其他命令不需要此参数。命令输出的提示信息中已包含该参数；请在后续操作中保留它。如果没有指定 Store，命令将对最近的本地 `openspec/` 根目录生效。

**输入**：可选地指定变更名称。如果省略，检查是否可以从对话上下文中推断。如果不明确或模糊，你必须提示用户选择可用的变更。

**步骤**

1. **如果未提供变更名称，提示用户选择**

   运行 `openspec-cn list --json` 获取按最近修改时间排序的可用变更。然后使用 **AskUserQuestion 工具** 让用户选择要更新的变更。

   将最近修改的前 3-4 个变更作为选项展示，显示：
   - 变更名称
   - Schema（来自 `schema` 字段，若不存在则显示 "spec-driven"）
   - 状态（例如 "0/5 任务"、"完成"、"无任务"）
   - 最近修改时间（来自 `lastModified` 字段）

   将最近修改的变更标记为 "(推荐)"，因为它很可能是用户想要更新的。

   **重要**：不要猜测或自动选择变更。始终让用户选择。

2. **获取变更的制品**
   ```bash
   openspec-cn status --change "<name>" --json
   ```
   解析 JSON 以了解当前状态。响应包括：
   - `schemaName`：正在使用的工作流 schema（例如 "spec-driven"）
   - `artifacts`：制品数组及其状态（"done"、"ready"、"blocked"）
   - `isComplete`：布尔值，指示所有制品是否已完成
   - `planningHome`、`changeRoot`、`artifactPaths` 和 `actionContext`：路径和作用域上下文。使用这些而不是假设仓库本地路径。

   制品 ID 和路径来自活动的 schema —— 不要假设它们，也不要根据硬编码的制品名称进行分支。自定义 schema 必须能不变地工作。

   要编辑的文件是 `artifactPaths.<id>.existingOutputPaths` —— 磁盘上实际存在的文件，已为 glob 制品进行了 glob 展开（例如 `specs/**/*.md`）。不要写入 `resolvedOutputPath`：对于 glob 制品，它仍然是 glob 模式，不是真实文件。

3. **理解请求**
   - 如果用户要求了特定的修订（"设计现在使用 X"），那就是起始编辑。
   - 如果用户只说"更新"/"使保持一致"，将其视为一致性审查：阅读现有制品并相互检查是否存在矛盾、遗漏和重复。

4. **阅读并调和**
   - 阅读请求涉及的制品以及变更的其他现有制品。
   - 应用请求的编辑。然后检查其他每个现有制品与它的一致性 —— 方向是任意的：对后续制品的编辑可能需要修订前面的制品，而不仅仅是从前往后。构建顺序是有用的阅读顺序，而不是对哪些制品可以修订的约束。
   - 记录所有现在不一致、缺失或矛盾的地方。
   - 仅修订已存在的文件（`existingOutputPaths`）。不要创建尚不存在的制品，也不要在 glob 制品下创建新文件 —— 记录它们并引导用户使用 `/opsx:continue` 来创建。
   - 如果变更已经一致，说明情况，不做任何编辑。

5. **确认并应用，每次一个制品**
   - 显示每个提议的修订及其原因。仅在用户确认后才写入。
   - 如果用户拒绝修订，不要写入 —— 保持该制品不变。
   - 当需要大量重写时，首先获取该制品的规则和模板：
     ```bash
     openspec-cn instructions <artifact-id> --change "<name>" --json
     ```

6. **指向下一步（仅指引 —— 永远不要执行）**
   - 仍有缺失的制品 -> 建议 `/opsx:continue` 来创建它们。
   - 变更已实施（任务已勾选/已应用）-> 代码可能不再与修订后的计划匹配；建议 `/opsx:apply` 将差异带入代码。
   - 一切完成并已实施 -> 建议 `/opsx:archive`。

**输出**

每次调用后，显示：
- 哪些制品被修订（以及哪些提议的修订被拒绝）
- 任何推迟到 `/opsx:continue` 的内容（尚未创建的制品或文件）
- 变更的状态和推荐的下一步命令

**护栏**
- 仅限规划制品 —— 永远不要编辑实现代码。如果修订后的计划暗示需要代码更改，停止并指向 `/opsx:apply`。
- 使用 `openspec-cn status` 报告的制品 ID 和路径；永远不要根据硬编码的制品名称进行分支。
- 仅编辑 `existingOutputPaths` 中的具体文件；永远不要写入 glob `resolvedOutputPath`。
- 不要推进构建前沿：不创建新制品，不在 glob 制品下创建新文件 —— 那是 `/opsx:continue` 的工作。
- 写入前与用户确认每个编辑。
- 如果请求改变了变更的*意图*而不仅仅是完善它，建议使用 `/opsx:new` 重新开始（"更新与重新开始"启发式规则）。
