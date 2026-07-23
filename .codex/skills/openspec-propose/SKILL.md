---
name: openspec-propose
description: 一步生成所有产出物来提议新变更。当用户想快速描述要构建的内容并获得包含设计、规范和任务的完整提案时使用。
allowed-tools: Bash(openspec-cn:*)
license: MIT
compatibility: 需要 openspec-cn CLI。
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.6.0"
---

提议新变更 - 一步创建变更并生成所有产出物。

我将创建一个包含以下产出物的变更：
- proposal.md（做什么 & 为什么）
- design.md（怎么做）
- tasks.md（实现步骤）

准备实现时，运行 /opsx:apply

---

**Store 选择：** 如果用户指定了某个 Store（Store 是在本机注册的独立 OpenSpec 仓库），或者工作位于某个 Store 中，请运行 `openspec-cn store list --json` 来查找已注册的 Store ID，然后在读写规范和变更的命令上传递 `--store <id>` 参数（`new change`、`status`、`instructions`、`list`、`show`、`validate`、`archive`、`doctor`、`context`）。其他命令不需要此参数。命令输出的提示信息中已包含该参数；请在后续操作中保留它。如果没有指定 Store，命令将对最近的本地 `openspec/` 根目录生效。

**输入**：用户的请求应当包含变更名称（kebab-case）或对想要构建内容的描述。

**步骤**

1. **如果没有提供明确的输入，询问他们想要构建什么**

   使用 **AskUserQuestion tool**（开放式，无预设选项）询问：
   > "您想要处理什么变更？请描述您想要构建或修复的内容。"

   根据他们的描述，推导出一个 kebab-case 名称（例如："add user authentication" → `add-user-auth`）。

   **重要提示**：在不了解用户想要构建什么的情况下，请勿继续。

2. **创建变更目录**
   ```bash
   openspec-cn new change "<name>"
   ```
   这将在 CLI 解析的规划主目录中创建一个脚手架变更。

3. **获取产出物构建顺序**
   ```bash
   openspec-cn status --change "<name>" --json
   ```
   解析 JSON 以获取：
   - `applyRequires`: 实现前所需的产出物 ID 数组（例如：`["tasks"]`）
   - `artifacts`: 所有产出物及其状态和依赖项的列表
   - `planningHome`、`changeRoot`、`artifactPaths` 和 `actionContext`：路径和范围上下文。使用这些而不是假设仓库本地路径。

4. **按顺序创建产出物直到准备好应用**

   使用 **TodoWrite tool** 跟踪产出物的进度。

   按依赖顺序循环遍历产出物（没有待处理依赖项的产出物优先）：

   a. **对于每个 `ready`（依赖项已满足）的产出物**：
      - 获取指令：
        ```bash
        openspec-cn instructions <artifact-id> --change "<name>" --json
        ```
      - 指令 JSON 包括：
        - `context`：项目背景（对你的约束 - 不要包含在输出中）
        - `rules`：产出物特定规则（对你的约束 - 不要包含在输出中）
        - `template`：用于输出文件的结构
        - `instruction`：此产出物类型的 Schema 特定指导
        - `resolvedOutputPath`：已解析的写入产出物的路径或模式
        - `dependencies`：已完成的产出物，用于读取上下文
      - 读取任何已完成的依赖文件以获取上下文
      - 使用 `template` 作为结构创建产出物文件，写入 `resolvedOutputPath`
      - 应用 `context` 和 `rules` 作为约束 - 但不要将它们复制到文件中
      - 显示简短进度："✓ 已创建 <artifact-id>"

   b. **继续直到所有 `applyRequires` 产出物完成**
      - 创建每个产出物后，重新运行 `openspec-cn status --change "<name>" --json`
      - 检查 `applyRequires` 中的每个产出物 ID 在 artifacts 数组中是否具有 `status: "done"`
      - 当所有 `applyRequires` 产出物完成时停止

   c. **如果产出物需要用户输入**（上下文不清楚）：
      - 使用 **AskUserQuestion tool** 进行澄清
      - 然后继续创建

5. **显示最终状态**
   ```bash
   openspec-cn status --change "<name>"
   ```

**输出**

完成所有产出物后，总结：
- 变更名称和位置
- 已创建产出物的列表及简要描述
- 准备就绪："所有产出物已创建！准备好实现。"
- 提示："运行 `/opsx:apply` 或要求我实现以开始处理任务。"

**产出物创建指南**

- 遵循每个产出物类型的 `openspec-cn instructions` 中的 `instruction` 字段
- Schema 定义了每个产出物应包含的内容，遵循它
- 在创建新产出物之前阅读依赖产出物以获取上下文
- 使用 `template` 作为输出文件的结构 - 填充其各个部分
- **重要提示**：`context` 和 `rules` 是对你的约束，而不是文件内容
  - 不要将 `<context>`、`<rules>`、`<project_context>` 块复制到产出物中
  - 这些引导你编写内容，但不应出现在输出中

**护栏**
- 创建实现所需的所有产出物（由 Schema 的 `apply.requires` 定义）
- 在创建新产出物之前始终阅读依赖产出物
- 如果上下文极其不清楚，询问用户 - 但倾向于做出合理的决定以保持势头
- 如果同名变更已存在，询问用户是否要继续处理它或创建一个新的
- 在继续下一个之前，验证写入后每个产出物文件是否存在
