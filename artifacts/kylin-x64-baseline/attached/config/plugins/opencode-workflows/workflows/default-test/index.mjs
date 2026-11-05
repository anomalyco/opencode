/**
 * default-test Workflow —— 单元测试与覆盖率阶段（完全独立，无共享库依赖）。
 *
 * 编排（GT13 门控重构，见 docs/WF-default-test-优化评审.md §12）：default-test 不再走 runMultiGate
 * 多维门控，按其阶段职责采用「执行+覆盖率单一硬 gate + 测试质量咨询审查」：
 *   异构并行检索（branches：模板读取/规约检索/代码库分析，合并命名 section）
 *   → 环境核验+测试任务规划（single）→ 测试代码编写（single）
 *   → 执行+覆盖率门控（单维 runStopGate，唯一硬 gate，loop 回补用例）
 *   → 测试质量审查（single，不 gate/不 loop，产出质量意见）
 *   → 测试报告生成（结合 gate 结果 + 质量意见）→ 落盘。
 *
 * 独立性（R2.2/R2.3）：本脚本内联 `num / str / parseVerdict / formatIssues / formatConfigPaths /
 * runStopGate` 的完整实现，**不 import/require** `_lib` 或任何同级 `default-*` 脚本，
 * 可单独编辑、单独运行。门控弃用 `format:json_schema`，改「自由文本 + 末行判定」由 `parseVerdict` 解析。
 *
 * 配置消费（R6.4/R6.5）：
 * - `ctx.config.template` / `ctx.config.rules` 非空时，把绝对路径拼入对应检索分支（指示子 Agent 用
 *   `read` 工具读取原文）；为空数组时回退脚本自带的默认检索；
 * - `ctx.config.template` 非空时，最终报告生成步遵循模板章节结构；
 * - `ctx.config.review` 在 GT13 后不再被审查步消费（无 runMultiGate 审查维度）；保留解析以兼容配置，
 *   不影响行为；
 * - `ctx.config.outputPath` 非空时，最终测试报告由框架 `ctx.writeFile` 直接写入该绝对路径；
 *   为 `null` 时跳过落盘并照常返回结构化产物。
 *
 * 行为参数为脚本内常量（不从 args/配置读取）：最大门控轮次、覆盖率目标。
 *
 * 独立运行：`/workflows-run` → 选 `default-test`。也可被其他 workflow 经
 * `ctx.workflow("default-test", { upstreamSummary })` 内联串联。
 *
 * args（可选）：{ feature?: string, upstreamSummary?: string }
 *
 * _Requirements: 1.1, 2.2, 2.3, 6.4, 6.5, 10.4, 10.5, 10.6_
 */

// ============================================================================
// 行为参数（审查门控最大轮次改为配置驱动 ctx.config.maxReviewRounds；其余脚本内常量）
// ============================================================================

/** 覆盖率达标阈值（百分比）。 */
const COVERAGE_TARGET = 80

// ============================================================================
// 内联辅助符号（原 _lib/harness-common.mjs，R2.2 完整内联，允许代码重复）
// ============================================================================

/** 取数值参数，非法时回退默认值。 */
function num(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/** 将任意 agent() 返回值安全转为字符串（用于拼接到下游 prompt）。 */
function str(value) {
  if (value == null) return "[无结果]"
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** 从门控自由文本解析末行判定（中英双语，取末个匹配，「不通过/fail」优先）。 */
function parseVerdict(text) {
  const s = String(text ?? "")
  if (s.trim().length === 0) return { passed: false, evaluable: false, issues: ["判定不可解析"] }
  const lines = s.split(/\r?\n/)
  const re = /(?:判定|verdict)\s*[:：]\s*(不通过|通过|fail|pass)/i
  let verdictIdx = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (re.test(lines[i])) { verdictIdx = i; break }
  }
  if (verdictIdx < 0) return { passed: false, evaluable: false, issues: ["判定不可解析"] }
  const m = re.exec(lines[verdictIdx])
  const token = (m && m[1] ? m[1] : "").toLowerCase()
  const passed = !(token.indexOf("不通过") >= 0 || token === "fail") && (token.indexOf("通过") >= 0 || token === "pass")
  const prose = lines.filter((_, i) => i !== verdictIdx).join("\n").trim()
  return { passed, evaluable: true, issues: passed ? [] : (prose ? [prose] : []) }
}

/** 把 issues 数组格式化为编号清单文本（供 fixPrompt 使用）。 */
function formatIssues(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return "（无）"
  return issues.map((it, i) => (i + 1) + ". " + it).join("\n")
}

/** 把配置资源的绝对路径数组格式化为「用 read 读取」指令片段；空数组返回空串。 */
function formatConfigPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return ""
  return paths.map((p, i) => `${i + 1}. ${p}`).join("\n")
}

/**
 * Ralph Loop / stop-gate（DSL 控制流）：门控未过则修正重跑，直至通过或轮次耗尽后降级。
 *
 * 门控审查 `agent()` 调用不再携带 schema；以 `parseVerdict` 解析末行判定：
 * - `raw == null`（执行器降级）→ 不可评估，不消耗修正轮次，提前降级返回；
 * - `!evaluable`（判定不可解析）→ 不可评估，不消耗修正轮次，提前降级返回；
 * - `passed=true` → 通过；
 * - `passed=false` 且未达上限 → 委派针对性修正（不从头重写），用修正后产物重新门控；
 * - 达 `maxRounds` 仍未通过 → 降级：保留当前产物、返回未解决 issues（不中止整体）。
 *
 * @param {object} ctx Orchestration_API。
 * @param {object} opts
 * @param {string} opts.phaseTitle 归属阶段标题。
 * @param {number} opts.maxRounds 最大门控轮次。
 * @param {unknown} opts.artifact 初始待门控产物。
 * @param {(artifact: unknown, round: number) => string} opts.gatePrompt 生成门控 prompt。
 * @param {(artifact: unknown, issues: string[], round: number) => string} opts.fixPrompt 生成修正 prompt。
 * @param {string} [opts.label] 进度标签前缀。
 * @param {string} [opts.agentType] 门控/修正 Agent 类型。
 * @returns {Promise<{ passed: boolean, evaluable: boolean, rounds: number, issues: string[], artifact: unknown }>}
 */
async function runStopGate(ctx, { phaseTitle, maxRounds, artifact, gatePrompt, fixPrompt, label, agentType }) {
  let current = artifact
  let round = 0
  let gate = { passed: false, evaluable: true, issues: [] }
  while (round < maxRounds) {
    round += 1
    const raw = await ctx.agent(gatePrompt(current, round), { label: label + " #" + round, phase: phaseTitle, ...(agentType ? { agentType } : {}) })
    if (raw == null) {
      // 基础设施失败（执行器返回 null）：不可评估，不消耗修正轮次，降级返回。
      return { passed: false, evaluable: false, rounds: round, issues: ["[不可评估] 门控未返回结果（基础设施失败）"], artifact: current }
    }
    gate = parseVerdict(raw)
    if (!gate.evaluable) {
      // 判定不可解析：不可评估，不消耗修正轮次，降级返回。
      return { passed: false, evaluable: false, rounds: round, issues: ["[不可评估] 判定不可解析"], artifact: current }
    }
    if (gate.passed) return { passed: true, evaluable: true, rounds: round, issues: [], artifact: current }
    // 未通过即修正（含最后一轮）：末轮终修产物不再复审，直接降级落盘（问题 9）。
    const fixed = await ctx.agent(fixPrompt(current, gate.issues, round), { label: "修正 #" + round, phase: phaseTitle, ...(agentType ? { agentType } : {}) })
    if (fixed != null) current = fixed
  }
  return { passed: false, evaluable: true, rounds: round, issues: gate.issues, artifact: current }
}

// ============================================================================
// meta（纯字面量，可被 ScriptLoader.extractMeta 静态提取；R8.1/R2.4/R10.5）
// ============================================================================

export const meta = {
  name: "default-test",
  description: "default-test 阶段：异构并行检索 → 环境核验+规划 → 测试代码编写 → 执行与覆盖率门控（唯一硬 gate）→ 测试质量审查 → 报告落盘",
  whenToUse: "已有实现代码，需要编写测试、运行并保证覆盖率达标，再经测试质量审查并产出测试报告时",
  phases: [{ title: "Test" }],
  outputName: "测试报告",
}

// ============================================================================
// 执行体
// ============================================================================

export default async function execute(ctx) {
  const args = ctx.args || {}
  const feature = args.feature || "当前需求"
  const upstream = args.upstreamSummary || "（未提供上游代码摘要）"

  // ── per-phase 配置 shim：从 ctx.config 的 per-phase 字段提取本阶段（Test）配置 ──
  const __PHASE = "Test"
  const __res = ctx.config.resourcesByPhase?.[__PHASE] ?? {}
  const __outputPath = ctx.config.outputPathByPhase?.[__PHASE] ?? null
  const maxRounds = ctx.config.maxReviewRoundsByPhase?.[__PHASE] ?? 3
  const coverageTarget = num(COVERAGE_TARGET, 80)
  const phaseTitle = "Test"

  // ── 消费 per-phase resources（绝对路径数组 / outputPath；缺失时为降级空块）──
  const templatePaths = Array.isArray(__res.template) ? __res.template : []
  const rulesPaths = Array.isArray(__res.rules) ? __res.rules : []
  // GT13：default-test 不再有审查维度消费 review，故不再解析 reviewPaths。
  const outputPath = __outputPath

  ctx.phase(phaseTitle)
  ctx.log(`[Test] 开始：feature=${feature}，覆盖率目标=${coverageTarget}%，最大轮次=${maxRounds}`)

  // ── 异构并行检索（branches：模板读取/规约检索/代码库分析）──
  // 每分支各自独立 intent / 资源 / agentType，并发执行后合并为命名 section 字符串供下游接力。
  const templatePrompt =
    templatePaths.length > 0
      ? `用 read 工具读取以下 test 阶段模板文件，返回其章节或结构：\n${formatConfigPaths(templatePaths)}`
      : `读取 test 阶段的文档/代码模板，返回其章节或结构；若无模板返回 "[无模板]"。`
  const rulesPrompt =
    rulesPaths.length > 0
      ? `用 read 工具读取以下工程规约文件，提炼为要点清单：\n${formatConfigPaths(rulesPaths)}`
      : `检索本需求相关的工程规约与约束，提炼为要点清单；若无规约返回 "[无规约]"。`
  const codebasePrompt =
    `通过 grep/glob 分析当前代码库结构、被测实现代码与现有测试，返回目录摘要与关键文件列表。\n\n` +
    `## 上游代码摘要\n${upstream}`

  const parts_context = await ctx.parallel([
    () => ctx.agent(templatePrompt, { label: "模板读取", phase: phaseTitle, required: true }),
    () => ctx.agent(rulesPrompt, { label: "规约检索", phase: phaseTitle, required: true }),
    () => ctx.agent(codebasePrompt, { label: "代码库分析", phase: phaseTitle, required: true }),
  ])
  const context = ["模板读取", "规约检索", "代码库分析"]
    .map((t, i) => "=== " + t + " ===\n" + str(parts_context[i]))
    .join("\n\n")

  // ── 环境核验 + 测试任务规划（单元→集成→边界）──
  // 「环境核验」降为本步骤 intent 表达（R10.6），不引入新原语。
  const plan = await ctx.agent(
    `第一步检测项目语言/运行时/测试框架/测试工具可用性/已有测试与覆盖率基线，记录于计划开头。\n` +
      `再基于检索上下文与上游代码，为「${feature}」生成测试任务清单（单元测试→集成测试→边界测试）。\n\n` +
      `## 检索上下文\n${context}\n\n## 上游代码摘要\n${upstream}`,
    { label: "环境核验+测试规划", phase: phaseTitle, required: true },
  )

  // ── 测试代码编写（基于实际代码 + 上游文档）──
  let testCode = await ctx.agent(
    `读取实际实现代码，结合 PRD/Design，编写完整测试用例：覆盖正常流程、异常流程、边界条件，` +
      `测试代码须能直接编译运行（import 正确、依赖完整）。返回已写测试摘要。\n\n` +
      `## 任务计划\n${str(plan)}\n\n## 上游代码摘要\n${upstream}`,
    { label: "测试代码编写", phase: phaseTitle, required: true },
  )

  // ── 测试执行与覆盖率（单维 gate / runStopGate）：失败或覆盖率不达标→补充/修正 ──
  const runGate = await runStopGate(ctx, {
    phaseTitle,
    maxRounds,
    artifact: testCode,
    label: "测试执行与覆盖率",
    gatePrompt: (artifact) =>
      `运行完整测试套件并收集覆盖率。判断：全部 PASS 且覆盖率 ≥ ${coverageTarget}% 为通过。\n\n` +
      "请审查以下产物。先逐条列出存在的问题（无问题则说明已通过），最后在末行输出判定：`判定: 通过` 或 `判定: 不通过`。\n\n## 待审查产物\n" +
      str(artifact),
    fixPrompt: (artifact, issues) =>
      `只针对以下失败用例或未覆盖路径补充/修正测试（不从头重写），返回修正后测试摘要：\n` +
      `${formatIssues(issues)}\n\n## 当前测试\n${str(artifact)}`,
  })
  testCode = runGate.artifact

  // ── 测试质量审查（single / GT13：不 gate、不 loop，仅产出咨询意见进报告）──
  // 审「断言是否有意义 / 是否用 mock 假数据伪造通过（防同义反复，GT12 坑1）/ 用例命名与组织」。
  // 质量问题主观、弱模型自动 loop 常越改越糊 → 降级为报告里的风险提示，交人判断。
  //
  // 关键（问题①修复）：上游 testCode 只是「已写测试摘要」文本，不是测试源码本身——真实测试代码
  // 已由前序步骤用工具写到磁盘。故本步**不靠 testCode 摘要**，而是引导 agent 自己用 glob/grep 定位
  // 本次新写的测试文件、用 read 读取其真实源码后再审；摘要仅作定位线索。否则审查无源码可审、整步作废。
  const qualityReview = await ctx.agent(
    `审查本次新写测试代码的「测试质量」（仅出具意见，不修改代码、不下通过/不通过判定）。\n\n` +
      `第一步（必做）：用 glob/grep 在项目测试目录定位本次新增/修改的测试文件，再用 read 读取其**真实源码**。\n` +
      `下方「测试改动摘要」仅作定位线索，**不是测试源码本身**，不可仅凭摘要下结论；必须读到真实测试文件内容。\n\n` +
      `第二步：基于读到的真实测试源码，逐条审查以下三点：\n` +
      `1. 断言是否有意义（是否真正验证行为，有无 expect(true) / assert True 之类空断言）；\n` +
      `2. 是否用 mock/假数据伪造通过、把实现现状直接抄进断言（同义反复测试，永远绿但抓不到 bug）；\n` +
      `3. 用例命名与组织是否清晰（正常/异常/边界是否分类、命名是否说明意图）。\n\n` +
      `逐条列出发现的问题与改进建议（标注涉及的测试文件/用例）；若未发现问题，明确说明测试质量良好。\n` +
      `若无法定位到任何测试文件，如实说明「未找到测试文件」，不要臆造审查结论。\n\n` +
      `## 测试改动摘要（仅定位线索，非源码）\n` +
      str(testCode),
    { label: "测试质量审查", phase: phaseTitle },
  )

  // ── 测试报告生成（最终交付产物；结合执行/覆盖率 gate 结果 + 质量审查意见）──
  const templateHint =
    templatePaths.length > 0
      ? `\n\n## 报告模板（用 read 工具读取并严格遵循其章节结构）\n${formatConfigPaths(templatePaths)}`
      : ""
  const report = await ctx.agent(
    `汇总本次测试工作，生成完整、可交付的「${feature}」测试报告（markdown），` +
      `至少包含：测试范围与策略、用例清单与结果、覆盖率（目标 ${coverageTarget}%）、` +
      `测试质量评估（基于下方质量审查意见，如实呈现风险，不要粉饰）、未解决问题与风险、结论。${templateHint}\n\n` +
      `【输出要求】只在回复正文里直接返回完整的报告 markdown 文本本身；` +
      `禁止调用 write/edit 等任何写文件工具，禁止自行创建或保存报告文件（落盘由框架统一完成，` +
      `你自写文件会造成重复落盘与文件名不一致）。允许用 read 工具读取模板/已有产物作为参考。\n\n` +
      `## 执行/覆盖率门控结果\n通过=${runGate.passed}（覆盖率目标 ${coverageTarget}%）\n` +
      `## 执行/覆盖率未解决问题\n${formatIssues(runGate.issues)}\n\n` +
      `## 测试质量审查意见\n${str(qualityReview)}\n\n## 测试代码摘要\n${str(testCode)}`,
    { label: "测试报告生成", phase: phaseTitle },
  )

  // ── 产出落盘（R6.4/R6.5；问题 8 修复：框架 ctx.writeFile 直写）──
  // 报告内容本就是脚本进程内存里的字符串（report），由框架 ctx.writeFile 确定性写盘（零 token、
  // 瞬时、可靠，父目录自动 mkdir -p），消除「让 LLM 逐字复写」导致的卡死/截断/改写。脚本无需
  // import，保持自包含。null→跳过并照常返回结构化产物。
  if (outputPath) {
    try {
      await ctx.writeFile(outputPath, str(report))
      ctx.log(`[Test] 落盘成功 → ${outputPath}`)
    } catch (e) {
      ctx.log(`[Test] ⚠ 落盘失败：${e && e.message ? e.message : String(e)}`)
    }
  } else {
    ctx.log(`[Test] 未配置 outputPath，跳过落盘，仅返回结构化产物`)
  }

  ctx.log(`[Test] 完成：执行/覆盖率通过=${runGate.passed}（测试质量审查已并入报告）`)

  return {
    phase: "test",
    feature,
    coverageTarget,
    runPassed: runGate.passed,
    rounds: { run: runGate.rounds },
    unresolved: [...runGate.issues],
    qualityReview: str(qualityReview),
    testCode: runGate.artifact,
    report: str(report),
    outputPath,
  }
}
