---
mod: code
steps: 9
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

确认上下文后停止当前 Step，并调用：
update-step(feature="<FEATURE>", module="code", step="Step_0", status="done")
由插件注入 Step_1；不要自行进入 Step_1，也不要调用 update-progress。

## Step_1: 配置收集
<!-- customizable: caution -->
<!-- description: 配置收集 -->

通过 question 工具依次询问用户以下 5 个配置项：

**问题 1 — 模板选择**
调用 question 工具询问：
"请选择{{MOD_LABEL}}阶段使用的模板："
选项：["使用本地文件（请输入路径）", "不使用模板"]
默认：不使用模板

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
选项：["2轮（默认）", "3轮", "1轮", "自定义"]
默认：2轮（默认）

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

## Step_3: 环境检测 + 任务规划
<!-- customizable: true -->
<!-- description: 环境检测 + 任务规划 -->

⚠️ 本阶段分两步：环境检测 → 生成任务计划。

### 步骤 A：环境检测（主 Agent 直接执行，不委派）

1. 检测项目语言（读取构建文件：pom.xml/build.gradle/package.json/go.mod/*.csproj/pyproject.toml）
2. 检测运行时版本（java -version / node -v / python --version / go version / dotnet --version）
3. 检测测试框架（读取依赖文件判断：JUnit 4/5、pytest、jest/vitest、go test 等）
4. 检测测试工具可用性（运行 --version 命令）
5. 检测项目是否已有实现代码和测试代码

如果检测到配置问题（如缺少测试依赖、版本不兼容），向用户报告问题并建议修复方案，不自动修改项目文件。

### 步骤 B：生成任务计划（委派 writing subagent）

delegate_task(category="writing", run_in_background=false, load_skills=[], prompt="先读取 {{INDEX_FILE}} 获取 feature 全局索引，再读取 {{CTX_FILE}} 获取检索上下文，生成结构化任务列表写入 {{PLAN_FILE}}。
⚠️ 任务计划开头必须记录步骤A的检测结果（格式：项目语言:<语言> | 运行时版本:<版本> | 构建工具:<工具名> | 测试框架:<框架名及版本> | 测试工具:<可用/不可用> | 已有代码:<是/否> | 已有测试:<是/否>）。
任务必须按TDD流程组织：每个新增功能模块分三步：[红灯]先写测试用例、[绿灯]写实现代码、[重构]优化代码结构。如果是存量代码新增特性，只为新增部分生成[红灯][绿灯]任务，已有代码不重写。")

等待子 Agent 完成后继续 Step_4。

## Step_4: TDD 红灯（测试先行）
<!-- customizable: true -->
<!-- description: TDD 红灯（测试先行） -->

⚠️ 使用前台阻塞执行（不加 run_in_background），等待子 Agent 完成后自动返回结果。

委派 deep category 执行 TDD 红灯阶段：
  delegate_task(category="deep", run_in_background=false, load_skills=[], prompt="读取 {{INDEX_FILE}} 和 {{CTX_FILE}} 和 {{PLAN_FILE}}，以及 docs/<FEATURE>/详细设计与程序设计文档.md（作为测试用例设计的主要依据）。
TDD红灯阶段：读取task_plan.md开头的检测结果。如果有[红灯]标记的任务，依据详细设计文档中的接口定义、数据结构、业务规则和边界条件，只为这些新增任务编写测试用例（不重写已有测试），运行测试确认全部FAIL。
{{LANG_HINT}}
每完成一个子任务更新task_plan.md对应条目为[x]。")

等待子 Agent 完成后继续 Step_5。

## Step_5: 代码实现
<!-- customizable: true -->
<!-- description: 代码实现 -->

⚠️ 使用前台阻塞执行（不加 run_in_background），等待子 Agent 完成后自动返回结果。

委派 deep category 执行代码实现阶段：
  delegate_task(category="deep", run_in_background=false, load_skills=[], prompt="读取 {{INDEX_FILE}} 和 {{CTX_FILE}} 和 {{PLAN_FILE}}。
代码实现阶段：读取task_plan.md，只实现有[绿灯]标记的新增任务，不重写已有代码，不修改测试文件。如果检索上下文中有工程规约，实现代码必须遵循规约要求。
⚠️ 本阶段只负责编写实现代码，不运行测试——测试验证由 Step_6 负责。
{{LANG_HINT}}
每完成一个子任务更新task_plan.md对应条目为[x]。")

等待子 Agent 完成后继续 Step_6。

## Step_6: TDD 绿灯（测试验证）
<!-- customizable: caution -->
<!-- description: TDD 绿灯（测试验证） -->

⚠️ 本阶段采用三步模式，由主 Agent 控制。
⚠️⚠️ 严禁跳过步骤 0！必须先完成环境检测并确认测试工具可用。

**步骤 0：环境检测与准备**（主 Agent 直接执行）【强制，不可跳过】
读取 {{PLAN_FILE}} 开头的检测结果，获取项目语言、测试框架和测试工具状态。
如果测试工具不可用：先尝试 Wrapper → 尝试安装 → 安装失败则停止执行。

**步骤 1：委派 deep 运行测试并收集结果**（前台阻塞）：
  delegate_task(category="deep", run_in_background=false, load_skills=[], prompt="read {{INDEX_FILE}}。{{LANG_HINT}}
运行所有测试，收集结果：失败用例清单或覆盖率百分比。直接返回结果，不要自行修复。")

**步骤 2：根据步骤 1 的返回结果判断**：

  情况 A — 有测试失败（Ralph Loop）：
    1. 主 Agent 从返回结果中提取失败用例清单
    2. 主 Agent 调用 update-progress 上报：
       ```
       update-progress(feature="<FEATURE>", module="code", status="in_progress", review_round=<当前轮次>, max_rounds={{MAX_REVIEW_ROUNDS}}, review_passed=false, review_stage="Step_6")
       ```
    3. 委派 deep 修正实现代码（不修改测试文件）：
       ```
       delegate_task(category="deep", run_in_background=false, load_skills=[], prompt="只修正以下失败用例对应的实现代码，不要修改测试文件，不要从头重写：\n<失败用例清单>")
       ```
    4. 修正完成后回到步骤 1（⚠️ 必须运行完整测试套件，不能只跑之前失败的用例，确保无回归）

  情况 B — 全部 PASS（无论覆盖率）：
    继续 Step_7

> ⚠️ 覆盖率检查由 Test 阶段负责，Code 阶段只关注测试是否全部通过。

**轮次耗尽降级**：若已达到 {{MAX_REVIEW_ROUNDS}} 轮测试仍有失败，不再继续循环，执行以下降级处理后继续 Step_7：
1. 保留当前代码（不回滚）
2. 在 `{{PLAN_FILE}}` 末尾追加"## ⚠️ 未解决测试失败清单"，列出最后一轮的失败用例
3. 调用 `update-progress(feature="<FEATURE>", module="code", status="in_progress", review_round={{MAX_REVIEW_ROUNDS}}, max_rounds={{MAX_REVIEW_ROUNDS}}, review_passed=false, review_stage="Step_6")`

## Step_7: 代码审查
<!-- customizable: true -->
<!-- description: 代码审查 -->

⚠️ 必须通过 delegate_task() 委派 Momus Agent 执行代码审查。

  delegate_task(subagent_type="momus", run_in_background=false, load_skills=[], prompt="⚠️ 第一步必须执行：read {{INDEX_FILE}}。再读取 {{CTX_FILE}} 和 {{PLAN_FILE}}。

⚠️ 当前阶段是 **CODE**，审查通过后只更新 index.md 中的 `- CODE ⬜` 行。

对已实现的代码执行四维度审查：

### 维度 1：规约遵循审查
读取 {{CTX_FILE}} 的'## 工程规约'章节。无规约则跳过。

### 维度 2：设计一致性审查
对照 docs/<FEATURE>/详细设计与程序设计文档.md 检查模块划分、接口契约、数据结构。

### 维度 3：测试覆盖审查
关键业务路径、异常/边界场景、覆盖率 ≥ 80%。

### 维度 4：自定义审查
读取 {{CTX_FILE}} 的'## 自定义审查要求'章节。无自定义审查则跳过。

⚠️ 审查报告持久化：写入 {{REVIEW_REPORT}}。多轮审查追加到同一文件。")

若审查不合格，执行以下循环（最多 {{MAX_REVIEW_ROUNDS}} 轮）：

**步骤 1**：主 Agent 从 Momus 返回结果中提取所有 ❌ 条目，形成问题清单

**步骤 2**：主 Agent 调用 update-progress 上报当前轮次：
```
update-progress(feature="<FEATURE>", module="code", status="in_progress", review_round=<当前轮次>, max_rounds={{MAX_REVIEW_ROUNDS}}, review_passed=false)
```

**步骤 3**：主 Agent 委派 deep subagent 针对性修正（不从头重写）：
```
delegate_task(category="deep", run_in_background=false, load_skills=[], prompt="读取 {{REVIEW_REPORT}} 获取审查报告，只针对以下问题进行修正，不要从头重写代码：\n<问题清单>")
```

**步骤 4**：修正完成后，重新委派 Momus 审查（回到本 Step 开头重新执行审查）

若审查通过，调用：
```
update-progress(feature="<FEATURE>", module="code", status="in_progress", review_round=<当前轮次>, max_rounds={{MAX_REVIEW_ROUNDS}}, review_passed=true)
```

审查通过后进入 Step_8。

**轮次耗尽降级**：若已达到 {{MAX_REVIEW_ROUNDS}} 轮仍未通过，不再继续循环，执行以下降级处理后直接进入 Step_8：
1. 保留当前最佳版本代码（不回滚）
2. 在代码仓库根目录创建或追加 `.harness/<FEATURE>/code_unresolved_issues.md`，列出最后一轮审查报告中的所有 ❌ 条目，每条以 `⚠️ TODO:` 标记
3. 调用 `update-progress(feature="<FEATURE>", module="code", status="in_progress", review_round={{MAX_REVIEW_ROUNDS}}, max_rounds={{MAX_REVIEW_ROUNDS}}, review_passed=false)`

## Step_8: 完成与进度更新
<!-- customizable: false -->
<!-- description: 完成与进度更新 -->

1. 更新 {{INDEX_FILE}}，记录 code 阶段产出：
   - 将 `- CODE ⬜` 改为 `- CODE ✅ → src/（<模块数>个模块，<测试数>个测试，覆盖率<X>%）`
   - 追加"## CODE 阶段详情"章节
2. 调用 update-progress：
   update-progress(feature="<FEATURE>", featureName="<FEATURE_TITLE>", module="code", status="done")
3. 向用户汇报完成情况

⚠️ 代码编写模块 Pipeline 到此结束。不要自动进入下一阶段。
等待用户明确指令后再继续。
