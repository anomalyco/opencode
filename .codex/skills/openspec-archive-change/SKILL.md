---
name: openspec-archive-change
description: 在实验性工作流中归档已完成的变更。当用户想在实现完成后定稿并归档变更时使用。
allowed-tools: Bash(openspec-cn:*)
license: MIT
compatibility: 需要 openspec-cn CLI。
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.6.0"
---

在实验性工作流中归档已完成的变更。

**Store 选择：** 如果用户指定了某个 Store（Store 是在本机注册的独立 OpenSpec 仓库），或者工作位于某个 Store 中，请运行 `openspec-cn store list --json` 来查找已注册的 Store ID，然后在读写规范和变更的命令上传递 `--store <id>` 参数（`new change`、`status`、`instructions`、`list`、`show`、`validate`、`archive`、`doctor`、`context`）。其他命令不需要此参数。命令输出的提示信息中已包含该参数；请在后续操作中保留它。如果没有指定 Store，命令将对最近的本地 `openspec/` 根目录生效。

**输入**：可选地指定变更名。若省略，检查能否从对话上下文推断。若模糊或歧义，必须提示用户从可用变更中选择。

**步骤**

1. **若未提供变更名，提示选择**

   运行 `openspec-cn list --json` 获取可用变更。使用 **AskUserQuestion tool** 让用户选择。

   仅展示活跃变更（非已归档）。
   若可用，展示每个变更使用的 schema。

   **重要提示**：切勿猜测或自动选择变更。始终由用户选择。

2. **检查产出物完成状态**

   运行 `openspec-cn status --change "<name>" --json` 检查产出物完成情况。

   解析 JSON 以了解：
   - `schemaName`：使用的工作流
   - `planningHome`、`changeRoot`、`artifactPaths` 和 `actionContext`：路径与范围上下文
   - `artifacts`：产出物列表及其状态（`done` 或其他）

   **若有产出物未 `done`：**
   - 展示警告列出未完成产出物
   - 使用 **AskUserQuestion tool** 确认用户是否继续
   - 用户确认则继续

3. **检查任务完成状态**

   读取任务文件（通常 `tasks.md`）检查未完成任务。

   统计 `- [ ]`（未完成）与 `- [x]`（已完成）任务。

   **若发现未完成任务：**
   - 展示警告显示未完成任务数
   - 使用 **AskUserQuestion tool** 确认用户是否继续
   - 用户确认则继续

   **若无任务文件：** 无任务相关警告地继续。

4. **评估 delta spec 同步状态**

   使用状态 JSON 中的 `artifactPaths.specs.existingOutputPaths` 检查 delta specs。若无，无同步提示地继续。

   **若存在 delta specs：**
   - 将每个 delta spec 与 `openspec/specs/<capability>/spec.md` 的主 spec 比较
   - 确定将应用哪些更改（新增、修改、删除、重命名）
   - 提示前展示合并汇总

   **提示选项：**
   - 若需更改："立即同步（推荐）"、"不同步归档"
   - 若已同步："立即归档"、"仍同步"、"取消"

   若用户选择同步，使用 Task tool（subagent_type: "general-purpose", prompt: "Use Skill tool to invoke openspec-sync-specs for change '<name>'. Delta spec analysis: <include the analyzed delta spec summary>"）。无论选什么都继续归档。

5. **执行归档**

   若 `planningHome.changesDir` 下不存在 `archive` 目录则创建：
   ```bash
   mkdir -p "<planningHome.changesDir>/archive"
   ```

   使用当前日期生成目标名：`YYYY-MM-DD-<change-name>`

   **检查目标是否已存在：**
   - 是：报错失败，建议重命名现有归档或使用不同日期
   - 否：移动 `changeRoot` 到归档目录

   ```bash
   mv "<changeRoot>" "<planningHome.changesDir>/archive/YYYY-MM-DD-<name>"
   ```

6. **展示汇总**

   展示归档完成汇总，包括：
   - 变更名
   - 使用的 schema
   - 归档位置
   - specs 是否已同步（如适用）
   - 关于任何警告的说明（未完成产出物/任务）

**成功时输出**

```
## 归档完成

**变更：** <change-name>
**Schema：** <schema-name>
**归档到：** 从 `planningHome.changesDir`/YYYY-MM-DD-<name>/ 派生的归档路径
**Specs：** ✓ 已同步到主 specs（或 "无 delta specs" 或 "跳过同步"）

所有产出物完成。所有任务完成。
```

**护栏**
- 若未提供变更选择，始终提示
- 使用产出物图（openspec-cn status --json）检查完成情况
- 不要因警告阻止归档 - 仅告知并确认
- 移动到归档时保留 .openspec.yaml（随目录一起移动）
- 展示清晰的发生了什么汇总
- 若请求同步，使用 openspec-sync-specs 方式（代理驱动）
- 若存在 delta specs，始终运行同步评估并在提示前展示合并汇总
