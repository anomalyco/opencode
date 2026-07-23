---
name: openspec-verify-change
description: 验证实现是否匹配变更产出物。当用户想在归档前确认实现完整、正确且连贯时使用。
allowed-tools: Bash(openspec-cn:*)
license: MIT
compatibility: 需要 openspec-cn CLI。
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.6.0"
---

验证实现是否匹配变更产出物（specs、tasks、design）。

**Store 选择：** 如果用户指定了某个 Store（Store 是在本机注册的独立 OpenSpec 仓库），或者工作位于某个 Store 中，请运行 `openspec-cn store list --json` 来查找已注册的 Store ID，然后在读写规范和变更的命令上传递 `--store <id>` 参数（`new change`、`status`、`instructions`、`list`、`show`、`validate`、`archive`、`doctor`、`context`）。其他命令不需要此参数。命令输出的提示信息中已包含该参数；请在后续操作中保留它。如果没有指定 Store，命令将对最近的本地 `openspec/` 根目录生效。

**输入**：可选地指定变更名。若省略，检查能否从对话上下文推断。若模糊或歧义，必须提示用户从可用变更中选择。

**步骤**

1. **若未提供变更名，提示选择**

   运行 `openspec-cn list --json` 获取可用变更。使用 **AskUserQuestion tool** 让用户选择。

   展示有实现任务的变更（存在 tasks 产出物）。
   若可用，展示每个变更使用的 schema。
   将任务未完成的变更标记为"（进行中）"。

   **重要提示**：切勿猜测或自动选择变更。始终由用户选择。

2. **检查状态以了解 schema**
   ```bash
   openspec-cn status --change "<name>" --json
   ```
   解析 JSON 以了解：
   - `schemaName`：使用的工作流（例如 "spec-driven"）
   - `planningHome`、`changeRoot`、`artifactPaths` 和 `actionContext`：路径与范围上下文
   - 此变更存在哪些产出物

3. **获取规划上下文并加载产出物**

   ```bash
   openspec-cn instructions apply --change "<name>" --json
   ```

   这返回变更目录和 `contextFiles`（产出物 ID -> 具体文件路径数组）。从 `contextFiles` 读取所有可用产出物。

4. **初始化验证报告结构**

   创建包含三个维度的报告结构：
   - **完整性**：跟踪任务和 spec 覆盖
   - **正确性**：跟踪需求实现和场景覆盖
   - **连贯性**：跟踪设计遵循和模式一致性

   每个维度可有 CRITICAL、WARNING 或 SUGGESTION 问题。

5. **验证完整性**

   **任务完成情况**：
   - 若 `contextFiles.tasks` 存在，读取其中每个文件路径
   - 解析复选框：`- [ ]`（未完成）与 `- [x]`（已完成）
   - 统计已完成与总任务数
   - 若存在未完成任务：
     - 为每个未完成任务添加 CRITICAL 问题
     - 建议："完成任务：<描述>" 或 "若已实现则标记为完成"

   **Spec 覆盖**：
   - 若 `contextFiles.specs` 中存在 delta specs：
     - 提取所有需求（以 "### Requirement:" 标记）
     - 对每个需求：
       - 在代码库中搜索与需求相关的关键词
       - 评估实现是否可能存在
     - 若需求似乎未实现：
       - 添加 CRITICAL 问题："未找到需求：<需求名>"
       - 建议："实现需求 X：<描述>"

6. **验证正确性**

   **需求实现映射**：
   - 对 delta specs 中的每个需求：
     - 在代码库中搜索实现证据
     - 若找到，记录文件路径和行范围
     - 评估实现是否匹配需求意图
     - 若检测到偏离：
       - 添加 WARNING："实现可能偏离 spec：<详情>"
       - 建议："对照需求 X 审查 <file>:<lines>"

   **场景覆盖**：
   - 对 delta specs 中的每个场景（以 "#### Scenario:" 标记）：
     - 检查代码中是否处理了这些条件
     - 检查是否存在覆盖该场景的测试
     - 若场景似乎未覆盖：
       - 添加 WARNING："场景未覆盖：<场景名>"
       - 建议："为场景添加测试或实现：<描述>"

7. **验证连贯性**

   **设计遵循**：
   - 若 `contextFiles.design` 存在：
     - 提取关键决策（查找 "Decision:"、"Approach:"、"Architecture:" 等章节）
     - 验证实现是否遵循这些决策
     - 若检测到矛盾：
       - 添加 WARNING："未遵循设计决策：<决策>"
       - 建议："更新实现或修订 design.md 以匹配现实"
   - 若无 design.md：跳过设计遵循检查，注明"无 design.md 可供验证"

   **代码模式一致性**：
   - 审查新代码与项目模式的一致性
   - 检查文件命名、目录结构、编码风格
   - 若发现显著偏差：
     - 添加 SUGGESTION："代码模式偏差：<详情>"
     - 建议："考虑遵循项目模式：<示例>"

8. **生成验证报告**

   **汇总记分卡**：
   ```
   ## 验证报告：<change-name>

   ### 汇总
   | 维度         | 状态               |
   |--------------|------------------|
   | 完整性       | X/Y 任务，N 个需求|
   | 正确性       | M/N 需求已覆盖    |
   | 连贯性       | 已遵循/问题       |
   ```

   **按优先级分组的问题**：

   1. **CRITICAL**（归档前必须修复）：
      - 未完成任务
      - 缺失的需求实现
      - 每个附带具体、可操作的建议

   2. **WARNING**（应修复）：
      - Spec/设计偏离
      - 缺失的场景覆盖
      - 每个附带具体建议

   3. **SUGGESTION**（最好修复）：
      - 模式不一致
      - 次要改进
      - 每个附带具体建议

   **最终评估**：
   - 若有 CRITICAL 问题："发现 X 个严重问题。归档前请修复。"
   - 若仅有警告："无严重问题。有 Y 个警告需考虑。可归档（带有 noted improvements）。"
   - 若全部通过："所有检查通过。可以归档。"

**验证启发式**

- **完整性**：聚焦客观清单项（复选框、需求列表）
- **正确性**：使用关键词搜索、文件路径分析、合理推断 - 不要求完全确定
- **连贯性**：寻找明显不一致，不挑剔风格
- **误报**：不确定时，优先 SUGGESTION 而非 WARNING，WARNING 而非 CRITICAL
- **可操作性**：每个问题必须有具体建议，适用时附文件/行引用

**优雅降级**

- 若仅存在 tasks.md：仅验证任务完成，跳过 spec/design 检查
- 若存在 tasks + specs：验证完整性和正确性，跳过设计
- 若产出物完整：验证全部三个维度
- 始终注明跳过了哪些检查及原因

**输出格式**

使用清晰的 markdown：
- 表格用于汇总记分卡
- 分组列表用于问题（CRITICAL/WARNING/SUGGESTION）
- 代码引用格式：`file.ts:123`
- 具体、可操作的建议
- 不要模糊建议如"考虑审查"
