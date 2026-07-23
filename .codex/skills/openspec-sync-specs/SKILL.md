---
name: openspec-sync-specs
description: 将变更中的增量规范同步到主规范。当用户希望将增量规范的变更更新到主规范中（而不归档变更）时使用。
allowed-tools: Bash(openspec-cn:*)
license: MIT
compatibility: 需要 openspec-cn CLI。
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.6.0"
---

将变更中的增量规范同步到主规范。

这是一个**代理驱动**的操作——你将读取增量规范并直接编辑主规范来应用变更。这允许智能合并（例如，添加一个场景而不复制整个需求）。

**Store 选择：** 如果用户指定了某个 Store（Store 是在本机注册的独立 OpenSpec 仓库），或者工作位于某个 Store 中，请运行 `openspec-cn store list --json` 来查找已注册的 Store ID，然后在读写规范和变更的命令上传递 `--store <id>` 参数（`new change`、`status`、`instructions`、`list`、`show`、`validate`、`archive`、`doctor`、`context`）。其他命令不需要此参数。命令输出的提示信息中已包含该参数；请在后续操作中保留它。如果没有指定 Store，命令将对最近的本地 `openspec/` 根目录生效。

**输入**：可选指定变更名称。如果省略，检查是否可以从对话上下文推断。如果模糊或不明确，你必须提示用户选择可用变更。

**步骤**

1. **如果未提供变更名称，提示用户选择**

   运行 `openspec-cn list --json` 获取可用变更。使用 **AskUserQuestion tool** 让用户选择。

   显示具有增量规范的变更（位于 `specs/` 目录下）。

   **重要**：不要猜测或自动选择变更。始终让用户选择。

2. **解析变更上下文**

   运行：
   ```bash
   openspec-cn status --change "<name>" --json
   ```

3. **查找增量规范**

   使用状态 JSON 中的 `artifactPaths.specs.existingOutputPaths` 作为增量规范文件列表。

   每个增量规范文件包含以下章节：
   - `## ADDED Requirements` - 要添加的新需求
   - `## MODIFIED Requirements` - 对现有需求的修改
   - `## REMOVED Requirements` - 要删除的需求
   - `## RENAMED Requirements` - 要重命名的需求（FROM:/TO: 格式）

   如果未找到增量规范，通知用户并停止。

4. **对每个增量规范，将变更应用到主规范**

   对 CLI 返回的每个仓库本地能力增量规范路径：

   a. **读取增量规范**以理解预期的变更

   b. **读取主规范**位于 `openspec/specs/<capability>/spec.md`（可能尚不存在）

   c. **智能应用变更**：

      **ADDED Requirements：**
      - 如果需求在主规范中不存在 → 添加它
      - 如果需求已存在 → 更新以匹配（视为隐式 MODIFIED）

      **MODIFIED Requirements：**
      - 在主规范中找到该需求
      - 应用变更——可以包括：
        - 添加新场景（无需复制已有场景）
        - 修改现有场景
        - 更改需求描述
      - 保留增量规范中未提及的场景/内容

      **REMOVED Requirements：**
      - 从主规范中删除整个需求块

      **RENAMED Requirements：**
      - 找到 FROM 需求，重命名为 TO

   d. **如果能力尚不存在，创建新的主规范**：
      - 创建 `openspec/specs/<capability>/spec.md`
      - 添加 Purpose 章节（可以简短，标记为 TBD）
      - 添加 Requirements 章节，包含 ADDED 需求

5. **显示摘要**

   应用所有变更后，总结：
   - 哪些能力已更新
   - 做了哪些变更（需求新增/修改/删除/重命名）

**增量规范格式参考**

```markdown
## ADDED Requirements

### Requirement: 新功能
系统应当执行某些新操作。

#### Scenario: 基本场景
- **WHEN** 用户执行 X
- **THEN** 系统执行 Y

## MODIFIED Requirements

### Requirement: 现有功能
#### Scenario: 要添加的新场景
- **WHEN** 用户执行 A
- **THEN** 系统执行 B

## REMOVED Requirements

### Requirement: 已废弃的功能

## RENAMED Requirements

- FROM: `### Requirement: 旧名称`
- TO: `### Requirement: 新名称`
```

**关键原则：智能合并**

与程序化合并不同，你可以应用**部分更新**：
- 要添加场景，只需在 MODIFIED 下包含该场景——无需复制已有场景
- 增量规范代表*意图*，而非整体替换
- 使用你的判断力合理合并变更

**成功输出**

```
## 规范已同步：<change-name>

已更新主规范：

**<capability-1>**：
- 新增需求："新功能"
- 修改需求："现有功能"（新增 1 个场景）

**<capability-2>**：
- 创建新规范文件
- 新增需求："另一个功能"

主规范现已更新。变更仍保持活跃——实现完成后归档即可。
```

**护栏**
- 在做出变更前，先读取增量规范和主规范
- 保留增量规范中未提及的现有内容
- 如果某些内容不清楚，请求澄清
- 在过程中展示你正在做的变更
- 该操作应是幂等的——运行两次应得到相同结果
