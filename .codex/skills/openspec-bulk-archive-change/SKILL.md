---
name: openspec-bulk-archive-change
description: 一次性归档多个已完成的变更。当需要归档多个并行变更时使用。
allowed-tools: Bash(openspec-cn:*)
license: MIT
compatibility: 需要 openspec-cn CLI。
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.6.0"
---

在单次操作中归档多个已完成的变更。

此技能允许您批量归档变更，通过检查代码库判断实际已实现的内容，从而智能处理 spec 冲突。

**Store 选择：** 如果用户指定了某个 Store（Store 是在本机注册的独立 OpenSpec 仓库），或者工作位于某个 Store 中，请运行 `openspec-cn store list --json` 来查找已注册的 Store ID，然后在读写规范和变更的命令上传递 `--store <id>` 参数（`new change`、`status`、`instructions`、`list`、`show`、`validate`、`archive`、`doctor`、`context`）。其他命令不需要此参数。命令输出的提示信息中已包含该参数；请在后续操作中保留它。如果没有指定 Store，命令将对最近的本地 `openspec/` 根目录生效。

**输入**：无需输入（通过提示选择）

**步骤**

1. **获取活跃变更**

   运行 `openspec-cn list --json` 获取所有活跃变更。

   若无活跃变更，告知用户并停止。

2. **提示选择变更**

   使用 **AskUserQuestion tool** 的多选模式让用户选择变更：
   - 展示每个变更及其 schema
   - 提供"全部变更"选项
   - 允许任意数量的选择（1+ 即可，2+ 是典型场景）

   **重要提示**：切勿自动选择。始终由用户选择。

3. **批量校验 - 收集所有所选变更的状态**

   对每个所选变更，收集：

   a. **产出物状态** - 运行 `openspec-cn status --change "<name>" --json`
      - 解析 `schemaName`、`artifacts`、`planningHome`、`changeRoot`、`artifactPaths` 和 `actionContext`
      - 记录哪些产出物为 `done`，哪些为其他状态

   b. **任务完成情况** - 从状态 JSON 读取 `artifactPaths.tasks.existingOutputPaths`
      - 统计 `- [ ]`（未完成）与 `- [x]`（已完成）
      - 若无任务文件，记为"无任务"

   c. **Delta specs** - 从状态 JSON 检查 `artifactPaths.specs.existingOutputPaths`
      - 列出存在哪些 capability spec
      - 对每个，提取需求名称（匹配 `### Requirement: <name>` 的行）

4. **检测 spec 冲突**

   构建 `capability -> [触及它的变更]` 的映射：

   ```
   auth -> [change-a, change-b]  <- 冲突（2+ 个变更）
   api  -> [change-c]            <- 正常（仅 1 个变更）
   ```

   当 2+ 个所选变更对同一 capability 都有 delta spec 时即存在冲突。

5. **主动解决冲突**

   **对每个冲突**，调查代码库：

   a. **阅读 delta specs** - 从每个冲突变更中理解其声称新增/修改的内容

   b. **搜索代码库** 寻找实现证据：
      - 查找实现各 delta spec 中需求的代码
      - 检查相关文件、函数或测试

   c. **确定解决方案**：
      - 若仅一个变更实际已实现 -> 仅同步该变更的 specs
      - 若两者都已实现 -> 按时间顺序应用（先旧后新，新者覆盖）
      - 若两者都未实现 -> 跳过 spec 同步，警告用户

   d. **记录解决方案**（每个冲突）：
      - 应用哪个变更的 specs
      - 顺序（若两者都应用）
      - 理由（在代码库中发现了什么）

6. **展示汇总状态表**

   展示一个汇总所有变更的表格：

   ```
   | 变更               | 产出物 | 任务 | Specs   | 冲突      | 状态   |
   |---------------------|-----------|-------|---------|-----------|--------|
   | schema-management   | 完成      | 5/5   | 2 delta | 无        | 就绪   |
   | project-config      | 完成      | 3/3   | 1 delta | 无        | 就绪   |
   | add-oauth           | 完成      | 4/4   | 1 delta | auth (!)  | 就绪*  |
   | add-verify-skill    | 剩余 1    | 2/5   | 无      | 无        | 警告   |
   ```

   对冲突，展示解决方案：
   ```
   * 冲突解决：
     - auth spec：将先应用 add-oauth 再应用 add-jwt（两者都已实现，按时间顺序）
   ```

   对未完成的变更，展示警告：
   ```
   警告：
   - add-verify-skill：1 个未完成产出物，3 个未完成任务
   ```

7. **确认批量操作**

   使用 **AskUserQuestion tool** 进行单次确认：

   - "归档 N 个变更？" 选项依据状态而定
   - 选项可能包括：
     - "归档全部 N 个变更"
     - "仅归档 N 个就绪变更（跳过未完成）"
     - "取消"

   若存在未完成变更，明确说明它们将带警告归档。

8. **为每个确认的变更执行归档**

   按确定的顺序处理变更（遵循冲突解决方案）：

   a. **同步 specs**（若存在 delta specs）：
      - 使用 openspec-sync-specs 方式（代理驱动的智能合并）
      - 对冲突，按解决顺序应用
      - 跟踪是否已完成同步

   b. **执行归档**：
      ```bash
      mkdir -p "<planningHome.changesDir>/archive"
      mv "<changeRoot>" "<planningHome.changesDir>/archive/YYYY-MM-DD-<name>"
      ```

   c. **跟踪每个变更的结果**：
      - 成功：归档成功
      - 失败：归档过程中出错（记录错误）
      - 跳过：用户选择不归档（如适用）

9. **展示汇总**

   展示最终结果：

   ```
   ## 批量归档完成

   已归档 3 个变更：
   - schema-management-cli -> archive/2026-01-19-schema-management-cli/
   - project-config -> archive/2026-01-19-project-config/
   - add-oauth -> archive/2026-01-19-add-oauth/

   跳过 1 个变更：
   - add-verify-skill（用户选择不归档未完成项）

   Spec 同步汇总：
   - 4 个 delta spec 已同步到主 specs
   - 1 个冲突已解决（auth：按时间顺序应用两者）
   ```

   若有失败：
   ```
   失败 1 个变更：
   - some-change：归档目录已存在
   ```

**冲突解决示例**

示例 1：仅一个已实现
```
冲突：specs/auth/spec.md 被 [add-oauth, add-jwt] 触及

检查 add-oauth：
- Delta 新增 "OAuth Provider Integration" 需求
- 搜索代码库... 找到 src/auth/oauth.ts 实现了 OAuth 流程

检查 add-jwt：
- Delta 新增 "JWT Token Handling" 需求
- 搜索代码库... 未找到 JWT 实现

解决方案：仅 add-oauth 已实现。将仅同步 add-oauth specs。
```

示例 2：两者都已实现
```
冲突：specs/api/spec.md 被 [add-rest-api, add-graphql] 触及

检查 add-rest-api（创建于 2026-01-10）：
- Delta 新增 "REST Endpoints" 需求
- 搜索代码库... 找到 src/api/rest.ts

检查 add-graphql（创建于 2026-01-15）：
- Delta 新增 "GraphQL Schema" 需求
- 搜索代码库... 找到 src/api/graphql.ts

解决方案：两者都已实现。将先应用 add-rest-api specs，
再应用 add-graphql specs（按时间顺序，新者优先）。
```

**成功时输出**

```
## 批量归档完成

已归档 N 个变更：
- <change-1> -> archive/YYYY-MM-DD-<change-1>/
- <change-2> -> archive/YYYY-MM-DD-<change-2>/

Spec 同步汇总：
- N 个 delta spec 已同步到主 specs
- 无冲突（或：M 个冲突已解决）
```

**部分成功时输出**

```
## 批量归档完成（部分）

已归档 N 个变更：
- <change-1> -> archive/YYYY-MM-DD-<change-1>/

跳过 M 个变更：
- <change-2>（用户选择不归档未完成项）

失败 K 个变更：
- <change-3>：归档目录已存在
```

**无变更时输出**

```
## 无可归档的变更

未找到活跃的变更。创建一个新变更即可开始。
```

**护栏**
- 允许任意数量的变更（1+ 即可，2+ 是典型场景）
- 始终提示选择，从不自动选择
- 尽早检测 spec 冲突，通过检查代码库解决
- 当两个变更都已实现时，按时间顺序应用 specs
- 仅当实现缺失时跳过 spec 同步（警告用户）
- 确认前展示清晰的逐变更状态
- 对整批使用单次确认
- 跟踪并报告所有结果（成功/跳过/失败）
- 移动到归档时保留 .openspec.yaml
- 归档目录目标使用当前日期：YYYY-MM-DD-<name>
- 若归档目标已存在，该变更失败但继续处理其他变更
