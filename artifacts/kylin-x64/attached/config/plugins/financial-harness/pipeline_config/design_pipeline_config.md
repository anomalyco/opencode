---
mod: design
steps: 7
---

## Step_0: 上下文恢复
<!-- customizable: false -->
<!-- description: 上下文恢复 -->

1. 调用 query-progress 工具查询当前项目进度
2. 判断当前需求来源：
   a. 如果 <user-request> 非空：这是新需求或用户明确指定了需求，直接使用
   b. 如果 <user-request> 为空且 .harness/progress.json 只有一个未完成的 feature：自动关联该 feature
   c. 如果 <user-request> 为空且 .harness/progress.json 有多个 feature：
      使用 question 工具让用户选择要继续的需求，选项从 .harness/progress.json 的 features 列表生成，
      格式为 "feature名称（PRD ✅ Design ⬜ Code ⬜ Test ⬜）"，
      同时提供 "Type your own answer" 让用户输入新需求
3. 确定 feature ID 后：
   - 文档目录：docs/<feature ID>/（长期保存，Git 追踪）
   - 工作目录：.harness/<feature ID>/（临时文件，.gitignore）
   - 索引文件：{{INDEX_FILE}}（feature 全局索引，跨阶段持久保存）
   - 如果是新需求，创建上述两个目录
4. 读取 {{INDEX_FILE}}（如果存在）获取 feature 全局状态和历史产出索引
   如果 {{INDEX_FILE}} 不存在，按以下格式创建（严格遵守此格式，不要自由发挥）：
   ```
   # Feature: <FEATURE>

   ## 已完成阶段
   - PRD ⬜
   - Design ⬜
   - Code ⬜
   - Test ⬜

   ## 检索资源索引
   | 资源 | 获取方式 | 文件位置 |
   |------|---------|---------|
   ```
5. 读取该 feature 对应的上游文档（{{UPSTREAM}}）：docs/<feature ID>/ 下的对应文档
6. 后续所有文件操作使用以下路径（将 <FEATURE> 替换为实际 feature ID）：
   - 索引文件：{{INDEX_FILE}}
   - 检索上下文：{{CTX_FILE}}
   - 任务计划：{{PLAN_FILE}}
   - 输出文档：{{DOC_FILE}}

确认上下文后停止当前 Step，并调用：
update-step(feature="<FEATURE>", module="design", step="Step_0", status="done")
由插件注入 Step_1；不要自行进入 Step_1，也不要调用 update-progress。

## Step_1: 配置收集
<!-- customizable: caution -->
<!-- description: 配置收集 -->

通过 question 工具依次询问用户以下 5 个配置项：

**问题 1 — 模板选择**
调用 question 工具询问：
"请选择{{MOD_LABEL}}阶段使用的模板："
选项：["使用默认模板", "使用本地文件（请输入路径）", "不使用模板"]
默认：使用默认模板

**问题 2 — 规约选择**
调用 question 工具询问：
"请选择{{MOD_LABEL}}阶段使用的规约文件："
选项：["使用本地文件（请输入路径）", "不使用规约"]
默认：不使用规约

**问题 3 — 审查文档**
调用 question 工具询问：
"请选择{{MOD_LABEL}}阶段使用的审查文档："
选项：["使用本地文件（请输入路径）", "不使用审查文档"]
默认：不使用审查文档

**问题 4 — 审查轮次**
调用 question 工具询问：
"请选择{{MOD_LABEL}}阶段的最大审查轮次："
选项：["3轮（默认）", "2轮", "1轮", "自定义"]
默认：3轮（默认）

**问题 5 — 输出位置**
调用 question 工具询问：
"请选择{{MOD_LABEL}}阶段的输出位置："
选项：["默认（docs/<FEATURE>/）", "自定义路径（请输入）"]
默认：默认（docs/<FEATURE>/）

收集完所有配置后，直接进入 Step_2。

## Step_2: 并行检索
<!-- customizable: true -->
<!-- description: 并行检索 -->

同时发起以下 2 个后台任务（run_in_background=true，并行执行）：

**动作 1 — 委派 Librarian 读取所有资源文档**（模板 + 规约 + 审查文档）：
  delegate_task(subagent_type="librarian", run_in_background=true, load_skills=[], prompt="依次读取以下资源，将每份内容完整返回，用 '---' 分隔：

  1. 模板（根据 Step_1 配置）：
     - 如果是内置模板 ID（default）：调用 get-template 工具，参数 mod='{{MOD}}' template='default'
     - 如果是本地文件路径：用 read 工具读取该文件完整内容
     - 如果是'不使用模板'：返回'[无模板]'

  2. 规约（根据 Step_1 配置）：
     - 如果是本地文件路径：用 read 工具读取该文件完整内容
     - 如果是'不使用规约'：返回'[无规约]'

  3. 审查文档（根据 Step_1 配置，可能有多个）：
     - 如果是本地文件路径：用 read 工具读取每个文件完整内容
     - 如果未配置：返回'[无审查文档]'

  返回格式：
  === 模板 ===
  <模板内容>
  === 规约 ===
  <规约内容>
  === 审查文档 ===
  <审查文档内容>
  ")

**动作 2 — 委派 Explore 分析代码库**：
  delegate_task(subagent_type="explore", run_in_background=true, load_skills=[], prompt="通过 grep/glob 分析当前代码库结构和现有模式，返回目录结构摘要和关键文件列表。")

等待两个后台任务完成后，用 background_output(task_id="...") 收集结果。

⚠️ 主 Agent 将两个子 Agent 的结果汇总，按以下固定结构写入 {{CTX_FILE}}：

```markdown
## Feature ID: <FEATURE>

## 模板内容
<从 Librarian 返回的模板内容，或"用户选择不使用模板">

## 工程规约
<从 Librarian 返回的规约内容，或"用户选择不使用规约">

## 代码库分析
<从 Explore 返回的完整目录结构 + 关键文件列表>

## 上游文档摘要
<上游文档（{{UPSTREAM}}）的关键内容摘要>

## 自定义审查要求
<从 Librarian 返回的审查文档内容，或"用户未配置自定义审查要求">
```

## Step_3: 任务规划
<!-- customizable: true -->
<!-- description: 任务规划 -->

通过 delegate_task 委派子 Agent 完成任务规划：
  delegate_task(category="writing", run_in_background=false, load_skills=[], prompt="先读取 {{INDEX_FILE}} 获取 feature 全局索引，再读取 {{CTX_FILE}} 获取检索上下文，结合用户需求和上游文档，生成结构化任务列表写入 {{PLAN_FILE}}。任务列表使用 markdown checkbox 格式（- [ ] / - [x]），后续每完成一个子任务需更新对应条目为 [x]。")

等待子 Agent 完成后继续 Step_4。

## Step_4: 文档生成
<!-- customizable: true -->
<!-- description: 文档生成 -->

⚠️ 必须通过 delegate_task() 委派子 Agent 生成文档，禁止主 Agent 自己直接编写。

  delegate_task(category="deep", run_in_background=false, load_skills=[], prompt="⚠️ 第一步必须执行：read {{INDEX_FILE}} 获取 feature 全局索引。再读取 {{CTX_FILE}} 和 {{PLAN_FILE}}。

基于检索到的信息，生成{{MOD_LABEL}}文档：

1. 如果 {{CTX_FILE}} 的'## 模板内容'有实际内容 → 严格按照模板的章节结构和顺序生成，每个章节都必须有内容
2. 如果 {{CTX_FILE}} 的'## 工程规约'有实际内容 → 文档内容必须符合规约中的所有要求
3. 如果都为'无' → 基于需求和最佳实践自由生成
4. 确保文档完整覆盖所有必要章节，不允许留空或用占位符
5. 使用 write 工具将文档写入 Step_1 配置的 output_path（默认：{{DOC_FILE}}）
6. 每完成一个子任务，更新 {{PLAN_FILE}} 对应条目为 [x]

⚠️ 文档必须是完整的、可交付的，不是草稿或大纲。")

等待子 Agent 完成后进入 Step_5。

## Step_5: 审查验证
<!-- customizable: true -->
<!-- description: 审查验证 -->

⚠️ 必须通过 delegate_task() 委派 Momus Agent 执行审查，禁止自己直接审查。

  delegate_task(subagent_type="momus", run_in_background=false, load_skills=[], prompt="⚠️ 第一步必须执行：read {{INDEX_FILE}}。再读取 {{CTX_FILE}} 和 {{PLAN_FILE}}。

⚠️ 当前阶段是 **DESIGN**，审查通过后只更新 index.md 中的 `- DESIGN ⬜` 行。

对已生成的{{MOD_LABEL}}文档执行多维度审查：

### 维度 1：模板遵循审查
读取 {{CTX_FILE}} 的'## 模板内容'章节。如果来源为'无'，跳过此维度。

### 维度 2：规约遵循审查
读取 {{CTX_FILE}} 的'## 工程规约'章节。如果来源为'无'，跳过此维度。

### 维度 3：设计一致性审查
对照 docs/<FEATURE>/概要设计文档.md 检查设计是否覆盖 PRD 中的所有功能需求。

### 维度 4：自定义审查
读取 {{CTX_FILE}} 的'## 自定义审查要求'章节。如果来源为'无'，跳过此维度。

### 审查结论
- 总体评定：✅ 通过 / ❌ 不通过（列出需修正项）

⚠️ 审查报告持久化：将完整审查报告写入 {{REVIEW_REPORT}}。多轮审查追加到同一文件末尾。")

### Ralph Loop（审查不通过时的修正循环）

若审查结论为 ❌ 不通过，执行以下循环（最多 {{MAX_REVIEW_ROUNDS}} 轮）：

**步骤 1**：主 Agent 从 Momus 返回结果中提取所有 ❌ 条目，形成问题清单

**步骤 2**：主 Agent 调用 update-progress 上报当前轮次：
```
update-progress(feature="<FEATURE>", module="design", status="in_progress", review_round=<当前轮次>, max_rounds={{MAX_REVIEW_ROUNDS}}, review_passed=false)
```

**步骤 3**：主 Agent 委派 writing subagent 针对性修正（不从头重写）：
```
delegate_task(category="writing", run_in_background=false, load_skills=[], prompt="读取 {{REVIEW_REPORT}} 获取审查报告，只针对以下问题进行修正，不要从头重写文档：\n<问题清单>")
```

**步骤 4**：修正完成后，重新委派 Momus 审查（回到本 Step 开头重新执行审查）

若审查通过，调用：
```
update-progress(feature="<FEATURE>", module="design", status="in_progress", review_round=<当前轮次>, max_rounds={{MAX_REVIEW_ROUNDS}}, review_passed=true)
```

审查通过后进入 Step_6。

**轮次耗尽降级**：若已达到 {{MAX_REVIEW_ROUNDS}} 轮仍未通过，不再继续循环，执行以下降级处理后直接进入 Step_6：
1. 保留当前最佳版本文档（不回滚）
2. 在文档末尾追加"## ⚠️ 未解决问题清单"章节，列出最后一轮审查报告中的所有 ❌ 条目
3. 调用 `update-progress(feature="<FEATURE>", module="design", status="in_progress", review_round={{MAX_REVIEW_ROUNDS}}, max_rounds={{MAX_REVIEW_ROUNDS}}, review_passed=false)`

## Step_6: 完成与进度更新
<!-- customizable: false -->
<!-- description: 完成与进度更新 -->

1. 更新 {{INDEX_FILE}}，记录 design 阶段产出：
   - 将"已完成阶段"中 `- DESIGN ⬜` 改为 `- DESIGN ✅ → {{DOC_FILE}}`
   - 在"检索资源索引"表格中追加 design 阶段的检索资源记录
2. 调用 update-progress 工具记录进度：
   update-progress(feature="<FEATURE>", featureName="<FEATURE_TITLE>", module="design", status="done")
3. 向用户汇报{{MOD_LABEL}}阶段完成情况，包括产出文件路径

⚠️ {{MOD_LABEL}}模块 Pipeline 到此结束。不要自动进入下一阶段。
等待用户明确指令后再继续。
