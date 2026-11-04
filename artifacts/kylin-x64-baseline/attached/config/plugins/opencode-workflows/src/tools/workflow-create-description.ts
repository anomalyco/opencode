/**
 * OpenCode Workflows —— `workflow-create` 工具的 Tool Description（隐藏生成规范）。
 *
 * 这是对标 Claude Code `Workflow` 工具的「authoring guide」：模型读得到、**不进对话**
 * （属工具 schema）。承载完整的动态 workflow 生成规范——对话流程、5 条契约、质量模式、
 * ASCII 流程图、per-phase 资源/轮次、调用约定。
 *
 * 单独成文件以保持 workflow-create.ts（编排逻辑）整洁，并便于独立维护规范内容。
 *
 * 「契约 6：质量模式 helper 完整内联」的三个 helper 代码块**复用 quality-helpers.ts 的源行常量**
 * （与 scaffold.ts 注入体同源），保证 `/workflows-create` 路径与 Studio 脚手架版本永不漂移。
 */

import {
  ADVERSARIAL_HELPER_SRC,
  FINDER_LOOP_HELPER_SRC,
  JUDGE_PANEL_HELPER_SRC,
} from "../tui/quality-helpers"

export const WORKFLOW_CREATE_DESCRIPTION = `通过对话式引导创建自定义 workflow，并校验契约后落盘到全局目录（自动注册）。

何时使用：用户想创建一个新的自定义 workflow（如「需求到代码的快速开发」「需求→设计→实现的严谨流程」
「安全审计」「代码迁移」「文档生成」等各类场景），经 /workflows-create 命令触发，或用户明确要求创建 workflow 时。

## 调用约定（重要）

本工具是「落盘 + 校验」执行器，不是对话器。你必须**先在对话中完成信息收集与脚本生成**，
确认无误后，再用最终产物调用本工具（传 name / script / config）。工具会做确定性契约校验
并写盘；若校验失败会返回违约清单，你据此修正 script 后**重新调用**。

## 第一阶段：对话收集（调用工具前完成）

**交互方式（必须）**：用 \`question\` 工具（OpenCode 提问框）收集用户输入，不要用纯文本对话。

### 提问最小化原则（必须遵守，减少打断次数）
1. **能合并就合并**：\`question\` 工具的 \`questions\` 是**数组**，一次调用可问多个**相互独立**的
   问题（用户在一个提问框里逐个回答后统一 Confirm）。把不依赖彼此答案的问题合并到**一次**调用，
   不要一个问题一次调用。仅当后一个问题依赖前一个的答案时（如「选了落盘才问输出路径」），才分次调用。
2. **路径在创建时直接收集（不要推到 Studio）**：资源路径 / 输出路径都在创建对话里**当场让用户输入**。
   让用户输入路径靠的是「Type your own answer」输入框（见第 3 条），不要让用户改去 Studio 才能填路径。
3. **关于「让用户直接输入文本」**：\`question\` 的 \`options\` 只是**可点选的标签**，选中只会把该标签
   当答案返回——它**不是输入框**。要让用户输入任意文本（如文件路径），靠的是工具默认开启的
   \`custom\`（末尾自动出现「Type your own answer」输入框）。因此**绝对不要**造一个名为「输入路径」
   的选项（点了它只会返回死标签「输入路径」，用户根本无法输入）。正确做法：问题文案里直接告诉
   用户「请在最下方『Type your own answer』直接输入路径」，options 只放「不需要 / 跳过」这类可点选分支。
4. **纯选择题关掉自由输入**：当某子问题是**固定几选一**、不需要用户自由输入时（如「规划粒度」
   二选一、「阶段方案是否同意」），给该子问题设 \`custom: false\`，避免末尾多出无意义的
   「Type your own answer」。需要自由输入的子问题（如改名、改描述、填路径）保持默认 \`custom: true\`。

### 核心信息（合并为 1 次 question 调用，含 3 个子问题）
把以下 3 项**一次性**用 \`question\`（questions 数组，3 个元素）问出来：
1. workflow 名称（kebab-case，如 req-to-code）。从需求推断后让用户确认：
   「我建议命名为 X，可以吗？」，options：["X (推荐)"]（\`custom: true\`，用户想改名用「Type your own answer」输入）。
2. 描述（一句话，≤256 字符）。推断后：「我建议描述为 Y，可以吗？」，options：["同意此描述 (推荐)"]
   （\`custom: true\`，想改描述用「Type your own answer」输入）。
3. 规划粒度（\`custom: false\`，**二选一，必须给全两个选项，不可漏**）：
   「接下来怎么做？(1) 详细规划：我逐项问阶段/资源/轮次/产出；(2) 直接生成：我自动推断快速生成。」
   options **必须恰好是这两项、且第一项在前**：["详细规划 (推荐)", "直接生成"]。
   ⚠ **严禁只放「直接生成」而漏掉「详细规划」**——两个选项缺一不可，顺序也不要颠倒。

- 选「直接生成」→ 跳过下面的详细问题，自动推断 phases/资源/轮次/产出，再走「质量模式主动推断」，直接到「生成前确认」。
- 选「详细规划」→ 按下面**尽量合并**地问：

  **① 阶段划分（1 次 question，\`custom: true\`）**：先建议再让用户确认。
  **按需求的轻重信号调整阶段数**，不要默认套重型瀑布流：
  - 轻量（快速/MVP/小工具/quick）→ 2 段，如 需求分析→代码实现
  - 中等 → 3 段，如 需求分析→设计→代码实现
  - 复杂/高可靠/大型系统 → 4 段，如 需求分析→概要设计→详细设计→代码实现
  options 放推荐方案如 ["同意此阶段划分 (推荐)"]；想调整用「Type your own answer」输入新的阶段列表。

  **② 各阶段资源类别（1 次 question，合并所有阶段的「类别选择」）**：用 questions 数组，
  **每个阶段一个子问题**，每个子问题 \`multiple: true\` 多选：
    - 子问题文案：「【阶段X】需要读取哪些外部资源类别？（多选；无则不选）」
    - options：[模板(template), 规约(rules), 审查清单(review)]
    - 类别命名规则：独立命名，如 req-analysis-template / high-level-design-review / code-rules（见契约 1）。

  **③ 资源路径（1 次 question，把②里被选中的所有类别合并问，当场输入路径）**：
    - 用 questions 数组，**②中每个被选中的类别一个子问题**（没选任何类别则跳过本步）：
      「请输入「\<类别中文名\>」的文件路径：」
    - **路径格式引导（务必在问题文案里写清，避免用户填错）**：
      · **相对项目根**：直接写 \`docs/templates/req.md\`（推荐，跨机器可移植）。
      · **绝对路径**：写完整盘符路径如 \`D:\\proj\\spec.md\`（Windows）或 \`/home/u/spec.md\`（类 Unix）。
      · ⚠ **开头不要加 \`/\`**（除非你真的要类 Unix 根目录）：\`/docs/x.md\` 会被当成**绝对路径**
        解析到当前盘符根（如 \`D:\\docs\\x.md\`），而不是项目下的 \`docs/\`。要项目内就写 \`docs/x.md\`。
    - **让用户用「Type your own answer」直接输入路径**；options 只放 ["此类别暂不配置(写 none)"]
      作为可点选的跳过项。用户输入的路径记录到 config 的 resources 对应类别；选「暂不配置」则写 \`"none"\`。
    - **不要把路径收集推到 Studio**——这里就要拿到真实路径。

  **④ 轮次 + 各阶段产出形态（1 次 question，合并）**：用 questions 数组：
    - 子问题 A（门控轮次，一次问全部阶段建议值）：「各阶段的审查轮次建议？如 需求分析:2 设计:3 代码实现:2
      （范围 1-10）」，用「Type your own answer」输入；options 可放 ["全部用默认 3 (推荐)"]。
    - 子问题 B+（**每个阶段一个子问题**，\`custom: false\` 三选一）：「【阶段X】这一阶段的产出形态是？」
      options **必须恰好是这三项**：
        · "文档(框架落盘 MD)" —— 产出是一份文档，由框架 \`ctx.writeFile\` 落盘成 MD（下一步会问输出路径）。
        · "代码/文件(写进仓库)" —— 产出是真实代码或文件树，由子 Agent 自己用 write/edit 写进仓库（不经框架落盘、不问输出路径）。
        · "仅中间结果(传下游)" —— 产出只是文本，传给下游阶段用，不产生任何文件。
      ⚠ 这三类决定了该阶段 agent 的 prompt 怎么写（见契约 3）：只有「文档」类才加 WRITE_BAN 并由框架落盘。

  **⑤ 输出路径（1 次 question，把④中选「文档(框架落盘 MD)」的阶段合并问，当场输入路径）**：
    - 用 questions 数组，**④中每个选「文档」形态的阶段一个子问题**（没有文档阶段则跳过本步；
      「代码/文件」与「仅中间结果」形态的阶段都不在此问、也不配 output_path）：
      「请输入「\<阶段名\>」的输出文件路径模板：」
    - **路径格式引导（务必在问题文案里写清）**：
      · 推荐**相对项目根**写法，如 \`docs/\<FEATURE\>/prd.md\` 或 \`docs/概要设计.md\`。
      · 支持占位符 \`\<FEATURE\>\`（本次运行的需求名）/ \`\<RUNID\>\`（运行 id），运行时自动替换。
      · ⚠ **开头不要加 \`/\`**：\`/docs/x.md\` 会被当成绝对路径写到当前盘符根（如 \`D:\\docs\\x.md\`），
        多半不是你想要的；要落到项目里就写 \`docs/x.md\`。绝对路径请写完整盘符（如 \`D:\\out\\x.md\`）。
    - **让用户用「Type your own answer」直接输入路径模板**；options 只放 ["此阶段暂不落盘(写 none)"]。
      输入的路径记录到 config 的 output_path；选「暂不落盘」则该阶段 output_path 写 null/none。
    - **不要把路径收集推到 Studio**。

  （理想情况：详细规划分支共约 5 次 question 调用——阶段/类别/资源路径/轮次+产出形态/输出路径，
  比逐阶段逐项分开问大幅减少。）

### 质量模式主动推断（信息收集完毕后执行，不另开问卷）

信息收集完毕后，**在展示确认摘要之前**，主动为各阶段判断是否叠加质量模式，
在确认摘要 + ASCII 流程图里**作为推荐直接标出**（用户可在确认里否决）——
不要弹「请选择质量模式」菜单，不要让用户自己枚举（他不知道有哪些模式）。

**可用质量模式调色板**（可自由选择、跨阶段搭配、同阶段可叠加多个）：

| 模式 | 核心机制 | 典型受益场景（仅示例，非穷举） | 实现 |
|---|---|---|---|
| **评审团（judge-panel）** | N 视角并行起草 → 打分 → 综合最优 + 嫁接亮点 | 设计/选型/架构：要「最优方案」而非确定性转换 | 契约 6 \`runJudgePanel\` |
| **对抗式验证（adversarial）** | N 反驳者并发挑战，达阈值即杀产物 | 代码/审计/复核：产物需被质疑才算可信 | 契约 6 \`runAdversarial\` |
| **挖到挖干（finder-loop）** | 持续派 finder 直到连续 K 轮无新增 | 枚举边界/漏洞/问题：需穷尽而非单次发现 | 契约 6 \`runFinderLoop\` |
| **多视角扫描（multi-sweep）** | 并发 agent 各负责一个正交维度，产出多份报告 | 多维覆盖：安全+性能+可维护性同时评估 | 直接 \`ctx.parallel\`，无需额外 helper |
| **完整性批评（completeness-critic）** | 末尾独立 agent 专门找「缺了什么」 | 任何需兜底保证不遗漏的阶段（PRD/设计/审计） | 直接单个 \`ctx.agent\`，无需额外 helper |
| **多视角验证（perspective-verify）** | 并发 agent 各从一个视角审查同一产物 | 复杂系统评审：正确性/安全/性能/可复现 | 直接 \`ctx.parallel\`，无需额外 helper |

**判断方式（你自由判断，不要套固定映射表）**：对每个阶段问自己——
「叠加某个模式后，这个阶段的产出会更可信或更优吗？」能说出**具体理由**就推荐，说不出就不加。
- ⚠ **按阶段本质判断，不要抠需求原文有没有关键词**。用户几乎不会写「我要做架构决策」，
  他只会说「概要设计」；设计阶段即使没出现「架构」二字，本质就是方案权衡，评审团对它天然有益。
- **不限制每阶段的模式数量、不限制模式组合**：一个阶段可叠加多个（如代码阶段既对抗式验证又完整性批评），
  也可在不同阶段用不同模式；调色板里的模式可自由搭配，能想到更合适的组合就用——不必拘泥上表的示例场景。
- 上表后三种（multi-sweep / completeness-critic / perspective-verify）**不需要契约 6 的 helper**，
  直接用 \`ctx.parallel\` / \`ctx.agent\` 原语手写即可，按需在脚本里实现。

**节制（避免过度堆砌，但不等于一个都不推）**：
- 没有具体理由的模式不加；不要为「显得专业」给每个阶段都套。
- 但典型的「需求→概要设计→详细设计→TDD 代码」流程里，概要设计推评审团、代码阶段推对抗式
  属于**有益推荐**，不是过度堆砌——该推就推，别因为「看起来像普通线性流程」就全部留空。
- 质量模式与门控**正交**：门控管「过/不过」，质量模式管「更优/更可信」，二者可叠加。

**展现方式**：在 ASCII 流程图该阶段框里用括号标注（如 \`[评审团: 完备/风险/体验]\`、
\`[对抗式: 3 反驳者/阈值 2]\`）；摘要表格加「质量模式」一列，列推荐项 + 一句具体理由；
不推荐的阶段写「—」。**推荐随确认一并呈现**，用户在同一个确认里同意/否决/调整，不另起 question 调用。

### 生成前确认（必做）
向用户展示**文字摘要 + ASCII 流程图**，确认后再生成脚本。ASCII 流程图示例（终端可读，不要用 mermaid）：
\`\`\`
┌─ 需求分析 ──────────────┐
│ 功能提取 ┐              │
│ 非功能   ├→ 合并 → 门控 │ → requirements.md
│ 边界条件 ┘              │
└─────────────────────────┘
         ↓ str(需求文档)
┌─ 概要设计 ──────────────┐
│ ...                      │
└─────────────────────────┘
\`\`\`

## 第二阶段：自由生成脚本（遵守结构要求 + 5 条契约）

### 脚本结构（必须，否则运行时报 SCRIPT_SYNTAX_ERROR）

脚本必须包含以下两个导出（缺一不可）：
1. \`export const meta = { name, description, phases }\` —— 纯字面量元数据
2. \`export default async function execute(ctx) { ... }\` —— 执行主体函数

**完整骨架**：
\`\`\`js
// 内联辅助函数（str / parseVerdict / formatIssues / runStopGate / runMultiGate）
function str(value) { ... }
// ...

export const meta = {
  name: "my-workflow",
  description: "...",
  phases: [{ title: "阶段1" }, { title: "阶段2" }],
}

export default async function execute(ctx) {
  const args = ctx.args || {}
  const feature = args.feature || "当前需求"
  // ... 编排逻辑（ctx.phase / ctx.agent / ctx.parallel / 门控 / ctx.writeFile）
  return { feature, allPassed: true }
}
\`\`\`

**常见错误**：只生成 meta 而忘了 execute 函数 → 运行时报 \`[SCRIPT_SYNTAX_ERROR] 脚本缺少可执行主体\`。

编排完全自由（phases/agent/parallel/pipeline/门控随需设计，不必照搬 default-*），但下列 5 条契约**绝不可违反**：

### 契约 1：资源 = 拿路径塞进 prompt，由子 Agent 用 read 工具读取（**脚本不自己读文件**）
⚠⚠ **最关键的契约**：运行时 \`ctx\` **没有 readFile**！脚本**不能自己读文件**。
正确模式分两步：
1. 从 \`ctx.config.resourcesByPhase?.["阶段名"]?.["类别名"] ?? []\` 取**路径字符串数组**
   （阶段名必须与 meta.phases 的 title 完全一致；类别名如 template/rules/review）。
   ⚠ 扁平 \`ctx.config.resources?.["类别"]\` 已废弃**恒为空**，禁止使用。
2. 把这些**路径**拼进给子 Agent 的 prompt，并明确写「**请先用 read 工具读取其内容**」——
   由子 Agent（它有 read 工具）自己读文件，脚本只负责传路径。

⚠ **read 的文件是只读输入**：引导语必须写明这些模板/规约文件**只读、严禁写回或修改**——
否则子 agent 可能把生成内容用 write 工具写回它刚读的模板文件，覆盖用户的输入（已实测发生）。
\`\`\`js
// ✅ 正确：取路径数组 → 塞进 prompt（含「只读」声明）→ 子 Agent 用 read 工具读
const tplHld = ctx.config.resourcesByPhase?.["概要设计"]?.["template"] ?? []
const tplLine = tplHld.length > 0
  ? "请先用 read 工具读取以下概要设计模板原文（【只读输入，严禁修改或写回该文件】），再据此生成：\n" + tplHld.join("\n") + "\n\n"
  : ""
// WRITE_BAN 见契约 3：禁止 agent 自己写文件，结果作为文本返回交框架落盘。
const hld = await ctx.agent(
  "你是资深架构师。" + tplLine + "原始需求：\n" + str(feature) + "\n\n请输出概要设计文档。" + WRITE_BAN,
  { label: "概要设计", phase: "概要设计" }
)
\`\`\`
\`\`\`js
// ❌ 错误：ctx 没有 readFile，运行时直接报 "ctx.readFile is not a function"
const tplHld = ctx.config.resourcesByPhase?.["概要设计"]?.["template"] ?? []
const content = await ctx.readFile(tplHld[0], "utf8")   // ❌ 绝不可用
\`\`\`
**注意**：不同 workflow 的阶段与类别数量不同（有的阶段无资源，有的有多个），
在「详细规划」分支逐阶段问用户「这个阶段需要哪些资源?」，用户说有就配，没有就跳过。

### 契约 2：审查轮次配置驱动（per-phase）
门控 maxRounds 必须读配置，禁止硬编码数字。per-phase 写法（阶段名同 meta.phases title）：
\`\`\`js
maxRounds: ctx.config.maxReviewRoundsByPhase?.["需求分析"] ?? ctx.config.maxReviewRounds ?? 3
\`\`\`

### 契约 3：文档阶段落盘只由框架 ctx.writeFile 做，且其 agent prompt 必须禁止自己写文件
本契约**只约束「文档(框架落盘 MD)」形态的阶段**（④ 中选此形态者）。对「代码/文件(写进仓库)」
与「仅中间结果(传下游)」形态的阶段**不适用**——见本契约末尾「形态适用范围」。

文档阶段的产出落盘**只能**用 \`await ctx.writeFile(path, str(artifact))\`（agent 把内容
**作为字符串返回**，脚本拿到后交框架写盘）。

⚠⚠ **极其重要（否则会破坏用户文件）**：子 agent 自带 write/edit 等写文件工具。若不约束，
「生成文档」的 agent 会**自作主张地把生成内容用 write 工具写到磁盘**——最坏情况是写回它刚
\`read\` 的那个**模板/规约文件**，把用户的输入文件覆盖掉（已实测发生：详细设计被写进了
financial-design.md 模板）。因此：

**每个「文档(框架落盘 MD)」形态的 agent，其 prompt 必须包含如下禁令段（务必逐字加上）**：
\`\`\`
【输出方式约束】
1. 禁止调用任何写文件工具（write / edit / fs_write / str_replace 等）：落盘由工作流框架统一负责，你无需也不应自行写盘。
2. 上面用 read 读到的模板/规约/审查文件是【只读输入】，严禁修改或写回这些文件。
3. 你只需把完整结果【作为本次回复的文本内容直接返回】，不要写任何文件。
\`\`\`
（拼进 prompt 的写法：\`agentPrompt + "\\n\\n【输出方式约束】\\n1. 禁止调用任何写文件工具…"\`）

**路径读取（纯 per-phase 字典）**：用 \`ctx.config.outputPathByPhase?.["阶段名"]\` 读该阶段的
输出路径模板（阶段名同 meta.phases title）。⚠ 全局 \`ctx.config.outputPath\` 已废弃**恒为 null**，
不要依赖它。未配置该阶段则不落盘。路径模板里的占位符 \`<FEATURE>\`/\`<RUNID>\` 需替换为实际值。

**示例（每阶段独立路径；agent 返回字符串，框架落盘）**：
\`\`\`js
const feature = ctx.args?.feature || "当前需求"
const WRITE_BAN = "\\n\\n【输出方式约束】\\n1. 禁止调用任何写文件工具（write/edit/fs_write/str_replace 等）：落盘由框架负责。\\n2. 上面 read 的模板/规约文件是只读输入，严禁修改或写回。\\n3. 只把完整结果作为本次回复文本直接返回，不要写任何文件。"
const hldArtifact = await ctx.agent(
  "你是资深架构师。" + hldTplLine + "原始需求：\\n" + str(feature) + "\\n\\n请输出完整的概要设计文档。" + WRITE_BAN,
  { label: "概要设计", phase: "概要设计" }
)
// 概要设计阶段落盘（未配置则跳过）——由框架写，不是 agent 写。
const hldOut = ctx.config.outputPathByPhase?.["概要设计"]
if (hldOut) {
  const p = hldOut.replace(/<FEATURE>/g, feature).replace(/<RUNID>/g, String(Date.now()))
  await ctx.writeFile(p, str(hldArtifact))
}
\`\`\`
这样用户在 studio 改 config 的 output_path 字典就能逐阶段改输出路径。

**形态适用范围（按 ④ 选的产出形态决定该阶段 agent 怎么写）**：
- **文档(框架落盘 MD)**：按上文——加 WRITE_BAN，结果作字符串返回，由 \`ctx.writeFile\` 落盘。
- **代码/文件(写进仓库)**：产出是真实代码/文件树，由 agent 自己写盘。**绝不要加 WRITE_BAN**
  （加了会堵死写文件能力，导致代码产不出来）；脚本既不调 \`ctx.writeFile\`、也不配该阶段
  output_path。agent 自己会用 write/edit 写文件，无需额外指引。
  ⚠⚠ **下游审查必看真实代码**：该阶段 \`ctx.agent\` 返回的只是开发者的**文字摘要**（如「我实现了
  XX 文件」），**不是真实代码**。如果该阶段后续有审查/门控/质量模式，它们的 prompt 必须明确指示
  agent「用 glob 和 read 工具找到并阅读项目源代码文件」，否则审查者只看到摘要、看不到代码本体 → 假审查、
  白跑。门控 \`gatePrompt\` 与 \`fixPrompt\`、对抗式反驳者、评审团起草者等**所有需要看代码的 agent**
  都必须加这段指引（代码已在磁盘上，用 read 读）。
- **仅中间结果(传下游)**：产出只是文本，传给下游 agent 用（\`str(上游变量)\` 插值）。不落盘、
  不加 WRITE_BAN。

### 契约 4：门控 helper 完整内联
若用 runStopGate/runMultiGate，必须完整内联以下 helper 函数定义。
**直接复制下面代码块到脚本顶部，不要去读取任何外部文件、不要 glob/grep 查找 default-* 脚本**：
\`\`\`js
function str(value) {
  if (value == null) return "[无结果]"
  if (typeof value === "string") return value
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}
function parseVerdict(text) {
  const s = String(text ?? "")
  if (s.trim().length === 0) return { passed: false, evaluable: false, issues: ["判定不可解析"] }
  const lines = s.split(/\\r?\\n/)
  const re = /(?:判定|verdict)\\s*[:：]\\s*(不通过|通过|fail|pass)/i
  let verdictIdx = -1
  for (let i = lines.length - 1; i >= 0; i--) { if (re.test(lines[i])) { verdictIdx = i; break } }
  if (verdictIdx < 0) return { passed: false, evaluable: false, issues: ["判定不可解析"] }
  const m = re.exec(lines[verdictIdx])
  const token = (m && m[1] ? m[1] : "").toLowerCase()
  const passed = !(token.indexOf("不通过") >= 0 || token === "fail") && (token.indexOf("通过") >= 0 || token === "pass")
  const prose = lines.filter((_, i) => i !== verdictIdx).join("\\n").trim()
  return { passed, evaluable: true, issues: passed ? [] : (prose ? [prose] : []) }
}
function formatIssues(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return "（无）"
  return issues.map((it, i) => (i + 1) + ". " + it).join("\\n")
}
async function runStopGate(ctx, { phaseTitle, maxRounds, artifact, gatePrompt, fixPrompt, label, agentType }) {
  let current = artifact, round = 0, gate = { passed: false, evaluable: true, issues: [] }
  while (round < maxRounds) {
    round += 1
    const raw = await ctx.agent(gatePrompt(current, round), { label: label + " #" + round, phase: phaseTitle, ...(agentType ? { agentType } : {}) })
    if (raw == null) return { passed: false, evaluable: false, rounds: round, issues: ["[不可评估] 门控未返回结果（基础设施失败）"], artifact: current }
    gate = parseVerdict(raw)
    if (!gate.evaluable) return { passed: false, evaluable: false, rounds: round, issues: ["[不可评估] 判定不可解析"], artifact: current }
    if (gate.passed) return { passed: true, evaluable: true, rounds: round, issues: [], artifact: current }
    const fixed = await ctx.agent(fixPrompt(current, gate.issues, round), { label: "修正 #" + round, phase: phaseTitle, ...(agentType ? { agentType } : {}) })
    if (fixed != null) current = fixed
  }
  return { passed: false, evaluable: true, rounds: round, issues: gate.issues, artifact: current }
}
async function runMultiGate(ctx, { phaseTitle, maxRounds, artifact, dimensions, fixPrompt }) {
  let current = artifact, round = 0
  let pending = Array.isArray(dimensions) ? dimensions.slice() : []
  let unresolved = [], unevaluable = []
  while (round < maxRounds) {
    round += 1
    const results = await ctx.parallel(pending.map((d) => {
      const opts = { label: phaseTitle + " · " + d.name + "(第" + round + "轮)", phase: phaseTitle }
      if (d.agentType) opts.agentType = d.agentType
      return () => ctx.agent(d.prompt(current), opts)
    }))
    const failed = []; unresolved = []; unevaluable = []
    for (let i = 0; i < pending.length; i++) {
      const r = results[i]
      if (r == null) { unevaluable.push("[不可评估] [" + pending[i].name + "] 门控未返回结果（基础设施失败）"); continue }
      const g = parseVerdict(r)
      if (!g.evaluable) { unevaluable.push("[不可评估] [" + pending[i].name + "] 判定不可解析"); continue }
      if (!g.passed) { failed.push(pending[i]); for (const issue of g.issues) unresolved.push("[" + pending[i].name + "] " + issue) }
    }
    if (failed.length === 0) return { passed: unevaluable.length === 0, evaluable: unevaluable.length === 0, rounds: round, issues: unevaluable, artifact: current }
    const fixed = await ctx.agent(fixPrompt(current, unresolved, round), { label: phaseTitle + " · 修正(第" + round + "轮)", phase: phaseTitle })
    if (fixed != null) current = fixed
    pending = failed
  }
  return { passed: false, evaluable: unevaluable.length === 0, rounds: round, issues: unresolved.concat(unevaluable), artifact: current }
}
\`\`\`

⚠⚠ **门控判定行格式（与上面 parseVerdict 配套的硬约束，违反则门控整体失效）**：
\`parseVerdict\` 是**机械解析器**——它只认一行 \`判定：通过\` 或 \`判定：不通过\`（中文）/ \`verdict: pass\`
或 \`verdict: fail\`（英文），从结果**末尾往前**找这一行。找不到 → 该次门控判为 **evaluable=false（不可评估）**，
\`runStopGate\` 会**立即 return 并跳过 fix 修正**、\`runMultiGate\` 把该维度记为不可评估——**整个门控白跑、
审查意见被丢弃、代码/文档一字不改**（已实测发生：审查 agent 写成「有条件通过」「必须修正后方可通过」
等富文本结论，一个都没被解析到，allPassed 假阴性且修正环节全部空转）。

因此**每个 \`gatePrompt\`、以及 runMultiGate 的每个 \`dimensions[].prompt\`，结尾都必须逐字加上如下指令**：
\`\`\`
【判定输出格式 · 必须严格遵守】
你可以在前面写审查分析，但你回复的【最后一行】必须且只能是下面两者之一，不得添加任何前后缀、标点、加粗或表格：
判定：通过
判定：不通过
（只要存在任一阻断性问题，就输出「判定：不通过」并在上方列出问题；全部通过才输出「判定：通过」。）
\`\`\`
\`\`\`js
// ✅ 正确：gatePrompt 末尾拼上判定格式指令
const VERDICT_FMT = "\\n\\n【判定输出格式 · 必须严格遵守】\\n你可以在前面写审查分析，但你回复的【最后一行】必须且只能是下面两者之一，不得添加任何前后缀、标点、加粗或表格：\\n判定：通过\\n判定：不通过"
gatePrompt: (current) => "你是审查专家。请审查：\\n" + str(current) + "\\n\\n列出所有阻断性问题。" + VERDICT_FMT,
\`\`\`
\`\`\`
❌ 错误：prompt 只松散写「请输出判定：通过或不通过」——强模型会发挥成「## 审查结论 | 有条件通过」
   这类富文本，没有独立的「判定：X」行，parseVerdict 解析不到 → 门控失效。
\`\`\`
注意：\`fixPrompt\` **不需要**这个格式约束（它产出的是修正后的产物，不是判定）；只有「做判定的 agent」需要。

### 契约 5：meta 纯字面量
\`export const meta = { name, description, phases: [...] }\` 必须是纯字面量，
禁止变量引用/函数调用/模板插值（框架用静态 AST 提取 meta）。

---

## ctx API 规范（必须遵守，不得臆造）

脚本只能调用 ctx 提供的方法，**禁止 import Node.js 模块**（沙箱不支持 fs/path/os 等）：

**Agent 调用**:
- \`ctx.agent(prompt, { label, phase, agentType?, required? })\` —— 调用 Agent，返回字符串结果
- \`ctx.parallel([() => ctx.agent(...), ...])\` —— 并发调用多个 Agent，返回结果数组

**文件操作（注意：只有写，没有读！）**:
- \`ctx.writeFile(path, content)\` —— 异步写文件（产出落盘），无返回值。
- ⚠ **没有 ctx.readFile**！脚本不能自己读文件。要读资源文件，把
  \`ctx.config.resourcesByPhase?.["阶段"]?.["类别"]\` 拿到的**路径**塞进给子 Agent 的 prompt，
  写明「请先用 read 工具读取其内容」，由子 Agent 用 read 工具读（见契约 1）。

**阶段与日志**:
- \`ctx.phase(phaseTitle)\` —— 切换当前阶段（对应 meta.phases）
- \`ctx.log(...)\` —— 打印日志

**配置读取（纯 per-phase；阶段名 = meta.phases 的 title）**:
- \`ctx.config.resourcesByPhase?.["阶段"]?.["类别"] ?? []\` —— 返回该阶段该类别的路径数组（单文件取 \`[0]\`，多文件遍历）。
  ⚠ 扁平 \`ctx.config.resources?.["类别"]\` 已废弃**恒为空**，禁止使用。
- \`ctx.config.maxReviewRoundsByPhase?.["阶段"] ?? ctx.config.maxReviewRounds ?? 3\` —— 读该阶段轮次配置。
- \`ctx.config.outputPathByPhase?.["阶段"]\` —— 读该阶段的输出路径模板（含 \`<FEATURE>\`/\`<RUNID>\` 占位符）。
  ⚠ 全局 \`ctx.config.outputPath\` 已废弃**恒为 null**，禁止依赖。未配置该阶段则不落盘。

**参数读取**:
- \`ctx.args?.feature\` —— 读用户传入的 feature 参数

**禁止事项**:
- ❌ \`import { readFileSync } from 'fs'\` —— 沙箱不支持 Node.js 模块
- ❌ \`ctx.readFile(...)\` —— **不存在**！运行时报 "ctx.readFile is not a function"。读文件交给子 Agent 的 read 工具。
- ❌ \`ctx.runAgent(...)\` / \`ctx.execute(...)\` —— 这些方法不存在，只能用 \`ctx.agent\`
- ❌ \`export default { async execute(ctx) {} }\` —— 必须是函数：\`export default async function execute(ctx)\`

### 数据传递自检
动态生成不用脚手架的 usePrev，用 \`str(上游变量)\` 显式插值传递。生成后自检：
每个下游 agent 是否通过 str(...) 拿到了它需要的全部上游产物（如 TDD 阶段需同时拿需求+设计+测试）。

### 门控判定格式自检（用了 runStopGate/runMultiGate 必查）
逐个检查每个 \`gatePrompt\` 与 \`dimensions[].prompt\`：结尾是否都拼上了「最后一行只输出
\`判定：通过\`/\`判定：不通过\`」的格式指令（见契约 4）？只要漏掉一个，对应门控就会被判为
「不可评估」→ 跳过修正、白跑且 allPassed 假阴性。\`fixPrompt\` 不需要此约束。

## 第三阶段：调用本工具落盘

生成**完整脚本**（meta + execute 函数 + 内联 helper）并自检后，调用本工具：
- name：确认的 workflow 名
- script：**完整 .mjs 内容**（必须包含 \`export const meta\` 和 \`export default async function execute\`，否则运行时报错）
- config：对应 \`<name>.config.json\` 内容（**纯 per-phase 嵌套格式**，键名为阶段名 = meta.phases 的 title）。
  ⚠ 框架**只认 per-phase 嵌套**，扁平 \`resources\`、全局字符串 \`output_path\`、数字 \`max_review_rounds\` 一律被
  判为旧格式而**整份拒绝**（导致资源/落盘全部失效）。用户未填路径的类别写 \`"none"\`；不同 workflow
  阶段/类别数量不同，按实际写。config 示例（阶段名须与 meta.phases 的 title 逐字一致）：
\`\`\`json
{
  "resources": {
    "概要设计": { "template": "docs/templates/hld.md" },
    "详细设计与程序设计": {
      "template": "docs/templates/dd.md",
      "review": "docs/review/dd-checklist.md"
    },
    "TDD代码开发": { "rules": "docs/rules/coding.md" }
  },
  "resourceLabels": {
    "概要设计": { "template": "概要设计模板" },
    "详细设计与程序设计": { "template": "详细设计模板", "review": "详细设计审查清单" },
    "TDD代码开发": { "rules": "TDD 编程规约" }
  },
  "max_review_rounds": { "概要设计": 2, "详细设计与程序设计": 2, "TDD代码开发": 2 },
  "output_path": {
    "概要设计": "docs/<FEATURE>/hld.md",
    "详细设计与程序设计": "docs/<FEATURE>/dd.md"
  }
}
\`\`\`
**格式要点**（违反任一即被拒绝）：
- \`resources\`：外层键 = **阶段名**，内层键 = **类别名**，值为**路径字符串或字符串数组**。
  ❌ 禁止扁平 \`{ "tdd-rules": "..." }\`（值不是嵌套对象）。
- \`output_path\`：**字典** \`{ 阶段名: 路径 }\`。❌ 禁止字符串 \`"docs/x.md"\`；❌ 禁止 \`output_path_by_phase\`（无此键）。
- \`max_review_rounds\`：**字典** \`{ 阶段名: 数字 }\`。❌ 禁止数字 \`3\`。
- 某阶段无资源/不落盘则在对应字典里**省略该阶段**（不要写 null）。

工具返回：
- 成功 → 报告写入路径；告知用户用 /workflows-run 选择运行。
- 契约违约 → 返回 violations 清单（含 contract/detail/fix）。**据此修正 script 后重新调用本工具**（最多 3 轮）。
- meta 非法 → 返回 metaError；修正 meta 为纯字面量后重新调用。

## 契约 6：质量模式 helper 完整内联（对抗验证 / 挖到挖干 / 评审团）

若你的 workflow 要用「对抗式验证」「挖到挖干」「评审团」这三种高价值质量模式，
**直接复制下面对应的 helper 函数定义到脚本顶部**（与契约 4 的门控 helper 同款做法），
不要去读取或 glob 查找任何 default-* 脚本。

**易错点硬约束（务必遵守，否则模式失效）**：
1. 对抗式：不确定（agent 返回 null 或判定不可解析）时**默认判为已反驳**（计入反驳数）——宁可错杀存疑产物，不放过。
2. 挖到挖干：**按 seen（已见）集合去重，不要按已确认集合去重**——否则被否决的发现每轮重现、永不收敛。
3. 任何上限/采样/截断：**必须 ctx.log() 出被截断或丢弃的内容**（No silent caps），不静默吞掉。

**依赖声明**：runAdversarial 依赖 parseVerdict（与契约 4 的门控共用同一实现）；用对抗式时须一并内联契约 4 给出的 parseVerdict。

**runAdversarial（对抗式验证：N 反驳者按阈值杀产物）**：
\`\`\`js
${ADVERSARIAL_HELPER_SRC.join("\n")}
\`\`\`

**runFinderLoop（挖到挖干：持续派 finder 直到收敛或达上限）**：
\`\`\`js
${FINDER_LOOP_HELPER_SRC.join("\n")}
\`\`\`

**runJudgePanel（评审团：多角度起草 → 打分 → 综合最优）**：
\`\`\`js
${JUDGE_PANEL_HELPER_SRC.join("\n")}
\`\`\`

**meta 约束**：这些 helper 是 execute 体内函数，不写入 meta，不破坏 meta 纯字面量约束。

## 质量模式（可自由组合搭配，按需激发更高质量编排）

**三种需要契约 6 helper 的核心模式**（已内联完整实现，直接调用）：
- **Judge panel**（评审团）：N 视角并行起草 → 打分 → 综合最优 + 嫁接亚军亮点。适合技术选型/架构设计。
- **Adversarial verify**（对抗式验证）：N 反驳者并发挑战，达阈值即杀产物。适合安全审计/代码复核/bug 发现。
- **Loop-until-dry**（挖到挖干）：持续派 finder 直到连续 K 轮无新增。适合边界穷举/问题盘点。

**三种直接用 ctx.parallel/ctx.agent 手写的轻量模式**（不需要额外 helper，按需在脚本里实现）：
- **Multi-modal sweep**（多维扫描）：并发 agent 各负责一个正交维度，产出多份独立报告（如安全+性能+可维护性同时评估）。
- **Perspective-diverse verify**（多视角验证）：并发 agent 各从一个视角审查同一产物（如正确性/安全/性能/可复现）。
- **Completeness critic**（完整性批评）：末尾独立 agent 专门找「缺了什么」，兜底保证不遗漏（PRD/设计/审计）。

**使用指南**：
- 可自由跨阶段搭配、同阶段叠加多个模式；不限制组合方式，由你根据 workflow 需求判断。
- 「质量模式主动推断」节已给出 6 种模式的调色板与判断方式，按需选择即可。

## 默认规则
- 默认顺序调用，真正独立才用 parallel（多路检索/多维审查）；勿为「显高级」过度并发。
- 门控只在需验证处用，勿为门控而门控；门控消耗轮次。
- 勿为「结构化」强行拆阶段（3 步能完成别拆 7 步）。
`
