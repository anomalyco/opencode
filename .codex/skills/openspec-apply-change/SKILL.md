---
name: openspec-apply-change
description: 从 OpenSpec 变更中实现任务。当用户想开始实现、继续实现或处理任务时使用。
allowed-tools: Bash(openspec-cn:*)
license: MIT
compatibility: 需要 openspec-cn CLI。
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.6.0"
---

从 OpenSpec 变更中实现任务。

**Store 选择：** 如果用户指定了某个 Store（Store 是在本机注册的独立 OpenSpec 仓库），或者工作位于某个 Store 中，请运行 `openspec-cn store list --json` 来查找已注册的 Store ID，然后在读写规范和变更的命令上传递 `--store <id>` 参数（`new change`、`status`、`instructions`、`list`、`show`、`validate`、`archive`、`doctor`、`context`）。其他命令不需要此参数。命令输出的提示信息中已包含该参数；请在后续操作中保留它。如果没有指定 Store，命令将对最近的本地 `openspec/` 根目录生效。

**输入**：可选地指定变更名。若省略，检查能否从对话上下文推断。若模糊或歧义，你必须提示用户从可用变更中选择。

**步骤**

1. **选择变更**

   若提供了名称，使用它。否则：
   - 若用户提到了某变更，从对话上下文推断
   - 若仅存在一个活跃变更，自动选择
   - 若存在歧义，运行 `openspec-cn list --json` 获取可用变更，并使用 **AskUserQuestion tool** 让用户选择

   始终宣告："使用变更：<name>"，以及如何覆盖（例如 `/opsx:apply <other>`）。

2. **检查状态以理解 schema**
   ```bash
   openspec-cn status --change "<name>" --json
   ```
   解析 JSON 以理解：
   - `schemaName`：使用的工作流（例如 "spec-driven"）
   - `planningHome`、`changeRoot` 和 `actionContext`：规划范围与编辑约束
   - 哪个产出物包含任务（spec-driven 通常是 "tasks"，其他 schema 检查状态输出）

3. **获取实现指令**

   ```bash
   openspec-cn instructions apply --change "<name>" --json
   ```

   返回：
   - `contextFiles`：产出物 ID -> 具体文件路径数组（因 schema 而异 - 可能是 proposal/specs/design/tasks 或 spec/tests/implementation/docs）
   - 进度（总数、已完成、剩余）
   - 带状态的任务列表
   - 基于当前状态的动态指令

   **处理状态：**
   - 若 `state: "blocked"`（缺失产出物）：展示消息，建议使用 openspec-continue-change
   - 若 `state: "all_done"`：祝贺，建议归档
   - 否则：继续实现

4. **读取上下文文件**

   读取实现指令输出中 `contextFiles` 下列出的每个文件路径。
   文件因使用的 schema 而异：
   - **spec-driven**：proposal、specs、design、tasks
   - 其他 schema：遵循 CLI 输出的 contextFiles

5. **展示当前进度**

   展示：
   - 使用的 schema
   - 进度："N/M 个任务已完成"
   - 剩余任务概览
   - CLI 的动态指令

6. **实现任务（循环直至完成或受阻）**

   对每个待处理任务：
   - 展示正在处理哪个任务
   - 进行所需的代码更改
   - 保持更改最小且聚焦
   - 在任务文件中标记任务完成：`- [ ]` → `- [x]`
   - 继续下一个任务

   **暂停条件：**
   - 任务不清晰 → 请求澄清
   - 实现揭示设计问题 → 建议更新产出物
   - 遇到错误或阻塞 → 报告并等待指导
   - 用户中断

7. **完成或暂停时，展示状态**

   展示：
   - 本次会话完成的任务
   - 总体进度："N/M 个任务已完成"
   - 若全部完成：建议归档
   - 若暂停：解释原因并等待指导

**实现期间输出**

```
## 实现中：<change-name>（schema: <schema-name>）

正在处理任务 3/7：<task description>
[...实现进行中...]
✓ 任务完成

正在处理任务 4/7：<task description>
[...实现进行中...]
✓ 任务完成
```

**完成时输出**

```
## 实现完成

**变更：** <change-name>
**Schema：** <schema-name>
**进度：** 7/7 个任务已完成 ✓

### 本次会话已完成
- [x] 任务 1
- [x] 任务 2
...

所有任务完成！准备归档此变更。
```

**暂停时输出（遇到问题）**

```
## 实现暂停

**变更：** <change-name>
**Schema：** <schema-name>
**进度：** 4/7 个任务已完成

### 遇到的问题
<description of the issue>

**选项：**
1. <option 1>
2. <option 2>
3. 其他方法

你想怎么做？
```

**护栏**
- 持续处理任务直至完成或受阻
- 开始前始终读取上下文文件（来自实现指令输出）
- 若任务有歧义，暂停并询问后再实现
- 若实现揭示问题，暂停并建议产出物更新
- 保持代码更改最小且限定于每个任务
- 完成每个任务后立即更新任务复选框
- 遇到错误、阻塞或不清晰需求时暂停 - 不要猜测
- 使用 CLI 输出的 contextFiles，不要假设具体文件名

**流畅工作流集成**

此 skill 支持 "对变更的操作" 模型：

- **可随时调用**：在所有产出物完成前（若存在任务）、部分实现后、与其他操作交错
- **允许产出物更新**：若实现揭示设计问题，建议更新产出物 - 非阶段锁定，流畅工作
