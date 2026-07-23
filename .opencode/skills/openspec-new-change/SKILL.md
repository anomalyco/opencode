---
name: openspec-new-change
description: 使用实验性产出物工作流启动新的 OpenSpec 变更。当用户想以结构化的分步方法创建新功能、修复或修改时使用。
allowed-tools: Bash(openspec-cn:*)
license: MIT
compatibility: 需要 openspec-cn CLI。
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.6.0"
---

使用实验性产出物驱动方法启动新变更。

**Store 选择：** 如果用户指定了某个 Store（Store 是在本机注册的独立 OpenSpec 仓库），或者工作位于某个 Store 中，请运行 `openspec-cn store list --json` 来查找已注册的 Store ID，然后在读写规范和变更的命令上传递 `--store <id>` 参数（`new change`、`status`、`instructions`、`list`、`show`、`validate`、`archive`、`doctor`、`context`）。其他命令不需要此参数。命令输出的提示信息中已包含该参数；请在后续操作中保留它。如果没有指定 Store，命令将对最近的本地 `openspec/` 根目录生效。

**输入**：用户的请求应当包含变更名（kebab-case）或对想要构建内容的描述。

**步骤**

1. **如果没有提供明确的输入，询问他们想要构建什么**

   使用 **AskUserQuestion tool**（开放式，无预设选项）询问：
   > "您想要处理什么变更？请描述您想要构建或修复的内容。"

   根据他们的描述，推导出一个 kebab-case 名称（例如："add user authentication" → `add-user-auth`）。

   **重要提示**：在不了解用户想要构建什么的情况下，请勿继续。

2. **确定工作流 schema**

   除非用户明确请求不同的工作流，否则使用默认 schema（省略 `--schema`）。

   **仅在用户提到以下情况时使用不同 schema：**
   - 特定 schema 名 → 使用 `--schema <name>`
   - "show workflows" 或 "what workflows" → 运行 `openspec-cn schemas --json` 让他们选择

   **否则**：省略 `--schema` 使用默认值。

3. **创建变更目录**
   ```bash
   openspec-cn new change "<name>"
   ```
   仅在用户请求特定工作流时添加 `--schema <name>`。
   这将在 CLI 解析的规划主目录中创建一个脚手架变更。

4. **展示产出物状态**
   ```bash
   openspec-cn status --change "<name>" --json
   ```
   使用返回的 `planningHome`、`changeRoot`、`artifactPaths` 和 `nextSteps`，而不是假设仓库本地路径。

5. **获取第一个产出物的指令**
   第一个产出物取决于 schema（例如 spec-driven 的 `proposal`）。
   检查状态输出找到第一个 status 为 "ready" 的产出物。
   ```bash
   openspec-cn instructions <first-artifact-id> --change "<name>"
   ```
   这会输出创建第一个产出物的模板和上下文。

6. **停止并等待用户指示**

**输出**

完成步骤后，总结：
- 变更名称和位置
- 使用的 schema/工作流及其产出物序列
- 当前状态（0/N 个产出物已完成）
- 第一个产出物的模板
- 提示："准备好创建第一个产出物了吗？只要描述这个变更是关于什么的，我来起草，或让我继续。"

**护栏**
- 不要创建任何产出物 - 仅展示指令
- 不要超出展示第一个产出物模板的范围
- 若名称无效（非 kebab-case），请求有效名称
- 若同名变更已存在，建议继续处理该变更
- 若使用非默认工作流则传递 --schema
