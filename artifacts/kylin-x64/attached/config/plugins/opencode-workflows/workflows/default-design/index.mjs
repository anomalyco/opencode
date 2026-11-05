/**
 * default-design Workflow —— 详细设计/程序设计阶段（独立可运行，无 _lib 依赖）。
 *
 * 金标准重写（scaffold-branches-multigate，任务 4.3）：本脚本只采用 WorkflowScaffolder
 * 的 `renderScript` 能够生成的写法，使「手写 default-*」与「向导走一遍 → renderScript 生成」
 * 结构一致（金标准原则，R10.2/R10.5/R10.6）。
 *
 *   检索（branches 异构并行）→ 详细设计文档生成（single，合并任务规划，先大纲后成文）
 *   → Design 审查（runMultiGate 多维门控：模板遵循/规约遵循/需求符合性/自定义）→ 产出落盘 → 完成。
 *
 * 两项金标准编排形态：
 * - **异构并行检索步（branches）**：经 `ctx.parallel` 并发「模板读取 / 规约检索 / 代码库分析」三路，
 *   各分支独立 intent / useConfig / agentType；上游 PRD 摘要经**首分支**接力承载（与 renderScript
 *   branches 渲染「仅首分支接力上游」同形），合并为命名 section 字符串 `=== <label> ===` 供下游接力。
 *   各路输出契约（DD4）：无配置→`[无模板]`/`[无规约]` 终止禁检索；有配置→结构化要点 + 原文路径，下游按需 read。
 * - **多维并发审查门控（runMultiGate）**：对设计文档并发执行四维审查（模板遵循/规约遵循/
 *   需求符合性/自定义），任一维度不过即整体不过，针对失败维度修正后增量重审，轮次耗尽降级保留产物。
 *   配置感知（DD3，对齐 prd §16 方案 2）：未配置 template/rules/review 的维度无对照基准→直接判过、不审、不塞文档；
 *   其中「需求符合性」维度（原「设计一致性」改名，DD2）对照需求/上游 PRD 检查设计是否覆盖全部需求，恒审。
 *
 * 命名空间隔离（R1.1）：meta.name 为 `default-design`，与用户自定义 workflow 永不同名。
 * 脚本独立化（R2.2/R2.3）：内联 str / parseVerdict / formatIssues / runStopGate /
 *   runMultiGate / num 等辅助符号，不 import / require `_lib` 或任何同级 default-* 脚本。
 * 企业配置桥接（R6.4/R6.5）：消费 ctx.config.resources（template/rules 拼入检索、review 拼入审查），
 *   ctx.config.outputPath 非空时由框架 ctx.writeFile 直接写盘、为 null 时跳过并照常返回结构化产物。
 * 静态可提取（R10.5）：meta 为纯字面量，可被 ScriptLoader.extractMeta 静态 AST 提取，不触发 META_INVALID。
 *
 * 独立运行：`/workflows-run` → 选择 "default-design" → 输入 feature。
 * 也可被其他 workflow 经 ctx.workflow("default-design", { upstreamSummary }) 串联。
 *
 * 配置：可在 workflows.config.json 顶层以 "default-design" 为键提供 template/rules/review/output_path。
 *
 * args（可选）：{ feature?: string, upstreamSummary?: string }
 *
 * 审查门控最大轮次由配置驱动：`ctx.config.maxReviewRounds`（经 `<name>.config.json` 的
 * `max_review_rounds` 解析，缺省 3、钳制 [1,10]），不再硬编码、不再读 `args.maxReviewRounds`。
 *
 * _Requirements: 1.1, 2.2, 2.3, 6.4, 6.5, 10.2, 10.5, 10.6_
 */

export const meta = {
  name: "default-design",
  description: "Design 阶段：branches 异构检索 → 详细设计文档生成（先大纲后成文）→ runMultiGate 多维审查（含需求符合性）→ 产出落盘",
  whenToUse: "已有产品需求文档(PRD)或需求描述，需要据此产出详细设计与程序设计文档（含技术方案、覆盖全部需求）并经多维审查门控时",
  phases: [{ title: "Design" }],
  outputName: "详细设计文档",
}

// ── 行为参数（审查门控最大轮次改为配置驱动 ctx.config.maxReviewRounds，不再脚本内硬编码）──

// ─────────────────────────────────────────────────────────────────────────────
// 内联辅助符号（与 renderScript 注入的 strHelperLines / gateHelperLines /
// multiGateHelperLines 同构；独立化后内联，允许代码重复，R2.2/R2.3）
// ─────────────────────────────────────────────────────────────────────────────

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

/** 取某资源类别的绝对路径数组（运行时缺失也不抛）；从 per-phase resource 映射取值。 */
function configPaths(res, category) {
  return (res && res[category]) || []
}

/**
 * Ralph Loop / stop-gate（DSL 控制流，单维门控）：门控未过则修正重跑，直至通过或轮次耗尽后降级。
 * 与 renderScript 的 gateHelperLines 注入同构；本 workflow 审查为多维门控（runMultiGate），
 * 此符号保留以与脚手架「hasGate 即注入 runStopGate」的产物结构一致（金标准）。
 *
 * 门控宽松化（金标准 #4）：去 schema、改用 parseVerdict 解析末行判定，新增 evaluable 字段；
 * raw == null（执行器降级）与 !evaluable（判定不可解析）两条提前返回不可评估、不进修正分支、
 * 不消耗修正轮次（R8.1/R8.2/R8.3）。
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

/** 多维并发审查门控：并发审查 + 任一不过即不过 + 针对性修正 + 增量重审 + 不可评估降级。 */
async function runMultiGate(ctx, { phaseTitle, maxRounds, artifact, dimensions, fixPrompt }) {
  let current = artifact
  let round = 0
  let pending = Array.isArray(dimensions) ? dimensions.slice() : []
  let unresolved = []
  let unevaluable = []
  while (round < maxRounds) {
    round += 1
    // 对当前 pending 各维度并发审查（无 schema，确定的 agentIndex 序）。
    const results = await ctx.parallel(
      pending.map((d) => {
        const opts = { label: phaseTitle + " · " + d.name + "(第" + round + "轮)", phase: phaseTitle }
        if (d.agentType) opts.agentType = d.agentType
        return () => ctx.agent(d.prompt(current), opts)
      }),
    )
    // 聚合：null/不可解析维度标「不可评估」（不进 failed、不消耗修正轮次）；可评估且未通过进 failed。
    const failed = []
    unresolved = []
    unevaluable = []
    for (let i = 0; i < pending.length; i++) {
      const r = results[i]
      if (r == null) {
        // 基础设施失败：标「不可评估」，不计入 failed。
        unevaluable.push("[不可评估] [" + pending[i].name + "] 门控未返回结果（基础设施失败）")
        continue
      }
      const g = parseVerdict(r)
      if (!g.evaluable) {
        unevaluable.push("[不可评估] [" + pending[i].name + "] 判定不可解析")
        continue
      }
      if (!g.passed) {
        failed.push(pending[i])
        for (const issue of g.issues) unresolved.push("[" + pending[i].name + "] " + issue)
      }
    }
    // 仅「可评估且未通过」的维度参与修正/重审；不可评估维度不消耗修正轮次。
    if (failed.length === 0) {
      return { passed: unevaluable.length === 0, evaluable: unevaluable.length === 0, rounds: round, issues: unevaluable, artifact: current }
    }
    // 有 fail 即针对性修正（含最后一轮）：末轮终修产物不再复审，直接降级落盘（问题 9）。
    const fixed = await ctx.agent(fixPrompt(current, unresolved, round), { label: phaseTitle + " · 修正(第" + round + "轮)", phase: phaseTitle })
    if (fixed != null) current = fixed
    pending = failed // 下一轮仅重审上轮 fail（增量重审）。
  }
  // 轮次耗尽降级：保留当前产物 + 返回未解决问题与不可评估标注。
  return { passed: false, evaluable: unevaluable.length === 0, rounds: round, issues: unresolved.concat(unevaluable), artifact: current }
}

// ─────────────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────────────

export default async function execute(ctx) {
  const args = ctx.args || {}
  const feature = args.feature || "当前需求"
  const upstream = args.upstreamSummary || "（未提供上游 PRD 摘要）"

  // ── per-phase 配置 shim：从 ctx.config 的 per-phase 字段提取本阶段（Design）配置 ──
  const __PHASE = "Design"
  const __res = ctx.config.resourcesByPhase?.[__PHASE] ?? {}
  const __outputPath = ctx.config.outputPathByPhase?.[__PHASE] ?? null
  const maxRounds = ctx.config.maxReviewRoundsByPhase?.[__PHASE] ?? 3
  const phaseTitle = "Design"

  // 企业配置（R6.4/R6.5）：template/rules 拼入检索、review 拼入审查、per-phase outputPath 落盘。
  ctx.phase(phaseTitle)
  ctx.log(`[Design] 开始：feature=${feature}，最大审查轮次=${maxRounds}`)
  ctx.log(
    `[Design] 配置 → 模板 ${configPaths(__res, "template").length} 项 / 规约 ${configPaths(__res, "rules").length} 项 / ` +
      `审查 ${configPaths(__res, "review").length} 项 / 落盘 ${__outputPath || "(未配置)"}`,
  )

  // ── 检索步（branches 异构并行）：模板读取 / 规约检索 / 代码库分析；上游 PRD 经首分支接力 ──
  // 输出契约（DD4，对齐 prd D2/D3/§8.2）：无配置→固定占位 + 终止 + 禁检索；有配置→结构化要点 + 原文路径（下游按需 read）。
  const parts_step1 = await ctx.parallel([
    () =>
      ctx.agent(
        configPaths(__res, "template").length
          ? [
              "你的任务：提炼详细设计文档模板的【章节结构】与【每章写作要求】，供下游详细设计文档生成 agent 遵循。",
              "模板原文路径（务必先用 read 工具读取其内容后再提炼）：\n" +
                configPaths(__res, "template").join("\n") +
                "\n输出要求：① 逐条列出章节标题及层级；② 每个章节用一句话说明写作要求/应包含内容；③ 末尾原样附上上述模板原文路径，并注明「下游如需完整细节可 read 此路径」。",
              args.upstreamSummary ? "上游上下文（上游 PRD 摘要）：\n" + str(upstream) : "",
            ]
              .filter(Boolean)
              .join("\n\n")
          : "本步骤未配置详细设计文档模板。直接输出一行 `[无模板]` 并结束；禁止调用任何工具去查找/检索/猜测模板，禁止臆造章节结构。",
        { label: "模板读取", phase: phaseTitle, required: true },
      ),
    () =>
      ctx.agent(
        configPaths(__res, "rules").length
          ? [
              "你的任务：检索并提炼与本需求相关的【工程规约/约束要点】，供下游遵循。",
              "规约原文路径（务必先用 read 工具读取其内容后再提炼）：\n" +
                configPaths(__res, "rules").join("\n") +
                "\n输出要求：① 以要点清单列出适用于本需求的规约条目；② 末尾原样附上上述规约原文路径，并注明「下游如需完整细节可 read 此路径」。",
            ].join("\n\n")
          : "本步骤未配置工程规约文档。直接输出一行 `[无规约]` 并结束；禁止调用任何工具去查找/检索/列举规约，禁止编造规约。",
        { label: "规约检索", phase: phaseTitle, required: true },
      ),
    () =>
      ctx.agent(
        [
          "你是只读代码探索 agent（READ-ONLY），擅长快速导航与分析代码库。仅使用 grep/glob/read 与只读 shell（ls、git status/log/diff、cat、head、tail）定位和分析【代码】。",
          "严禁：创建/修改/删除/移动任何文件、用重定向或 heredoc 写盘、执行任何改变系统状态的命令——本步是纯只读探索，你没有写权限。",
          "任务：分析当前代码库的结构与现有实现模式（现有功能、模块/目录划分、关键源码文件、技术栈与约定），为下游详细设计生成提供「现有系统现状」参考。返回目录结构摘要 + 关键【源码】文件清单（含路径，供下游按需 read）。",
          "边界：聚焦【代码】本身。不要把 README、docs、spec、规约、审查清单、设计文档等文档/规范类文件当作「关键文件」或规范依据纳入——规范来源由配置（模板/规约）显式提供，本步只反映代码现状，不替下游决定遵循哪些规范。",
          "将发现作为普通消息直接汇报，不要创建任何文件。",
        ].join("\n\n"),
        { label: "代码库分析", phase: phaseTitle, required: true },
      ),
  ])
  // 合并为命名 section 字符串（下游 usePrev 接力此值）。
  const step1 = ["模板读取", "规约检索", "代码库分析"]
    .map((t, i) => "=== " + t + " ===\n" + str(parts_step1[i]))
    .join("\n\n")

  // ── 详细设计文档生成（single，合并原「任务规划」步：先大纲后成文；引导 read PRD；required 关键步）──
  // DD5：删独立「任务规划」step，文档生成先产设计大纲（含任务分解）再据其展开为完整详细设计。
  // DD1：需求来源为运行输入 feature（可含 PRD/需求文档路径）+ 串联 upstream；引导 agent 见路径先 read。
  const prompt_step2 = [
    "你是系统设计师。请基于上游检索上下文与需求，为「" + feature + "」编写一份完整的【详细设计/程序设计文档】。",
    "需求来源：本次运行输入（feature）即需求描述；若其中包含 PRD/需求文档路径，请先用 read 工具读取其内容作为设计依据，不要臆造需求。",
    "上游 PRD 摘要（串联运行时提供，独立运行可能为空占位）：\n" + str(upstream),
    "请先核验设计所需输入与前提是否就绪（缺失则在文档中显式标注假设）；再【先输出设计大纲（含模块/任务分解清单）】，随后据大纲逐节展开为完整、可交付的详细设计。",
    "若上游提供了文档模板章节结构，严格遵循其章节结构与各章节写作要求；若提供了工程规约，须遵循。",
    "上游上下文（检索结果）：\n" + str(step1),
    "## 交付约束（严格遵守）\n" +
      "1. **你的唯一交付方式**：把文档正文作为本次回复的【纯文本内容】返回，从文档标题第一行开始到文档末尾，不要任何前言或后续操作说明。\n" +
      "2. **禁止调用写文件工具**（如 fs_write、str_replace 等）：文件落盘由工作流框架负责，你无需也不应自行写盘。\n" +
      "3. **回复纯净性**：回复中只允许出现文档正文本身，不要输出 `<think>`、`<reflection>` 等标签，不要「已写入文件」之类的操作确认，不要任何对文档的说明或摘要。\n" +
      "4. **完整性**：必须包含大纲展开后的所有章节完整内容，不能只返回大纲或部分章节。",
  ]
    .filter(Boolean)
    .join("\n\n")
  const step2 = await ctx.agent(prompt_step2, { label: "详细设计文档生成", phase: phaseTitle, required: true })

  // ── Design 审查（runMultiGate 多维门控：模板遵循/规约遵循/需求符合性/自定义）──
  // DD3（对齐 prd §16 方案 2）：各维度对照各自来源；未配置 template/rules/review 的维度【无对照基准 → 直接判过、不审、不塞文档、不调工具】。
  // DD2：原「设计一致性」改名「需求符合性」——对照需求/上游 PRD 检查设计是否覆盖全部需求，此维度恒审（需求输入恒在）。
  const __tpl = configPaths(__res, "template")
  const __rules = configPaths(__res, "rules")
  const __review = configPaths(__res, "review")
  const __verdict =
    "请审查以下产物。先逐条列出存在的问题（无问题则说明已通过），最后在末行输出判定：`判定: 通过` 或 `判定: 不通过`。\n\n## 待审查产物\n"
  // 未配置维度的「直接判过」指令（含「末行输出判定」与「判定: 通过」字样，供 parseVerdict 解析、并被识别为门控调用）。
  const __skip = (cat) =>
    "本阶段未配置" + cat + "：本维度无对照基准、无需审查。请直接在末行输出判定：`判定: 通过`，不要列出任何问题，也不要调用任何工具。"
  const step3 = await runMultiGate(ctx, {
    phaseTitle,
    maxRounds,
    artifact: step2,
    dimensions: [
      {
        name: "模板遵循",
        prompt: (artifact) =>
          __tpl.length
            ? [
                "审查详细设计文档是否遵循模板的章节结构与格式；请先用 read 工具读取以下模板原文再对照：\n" + __tpl.join("\n"),
                __verdict + str(artifact),
              ].join("\n\n")
            : __skip("详细设计文档模板（template）"),
      },
      {
        name: "规约遵循",
        prompt: (artifact) =>
          __rules.length
            ? [
                "审查详细设计文档是否遵循工程规约与约束；请先用 read 工具读取以下规约原文再对照：\n" + __rules.join("\n"),
                __verdict + str(artifact),
              ].join("\n\n")
            : __skip("工程规约（rules）"),
      },
      {
        name: "需求符合性",
        prompt: (artifact) =>
          [
            "审查详细设计是否覆盖并符合需求：是否实现了需求/上游 PRD 描述的全部功能、与需求保持一致、无遗漏无偏离。",
            "需求来源（feature）：" + feature,
            "## 上游 PRD 摘要\n" + str(upstream),
            "若上述需求描述中包含 PRD/需求文档路径，请先用 read 工具读取其内容作为对照基准。",
            __verdict + str(artifact),
          ]
            .filter(Boolean)
            .join("\n\n"),
      },
      {
        name: "自定义",
        prompt: (artifact) =>
          __review.length
            ? [
                "请对照以下审查清单审查详细设计文档（先用 read 工具读取其内容）：\n" + __review.join("\n"),
                __verdict + str(artifact),
              ].join("\n\n")
            : __skip("审查清单（review）"),
      },
    ],
    fixPrompt: (artifact, issues) =>
      [
        "针对以下审查问题修正当前文档，直接返回修正后的完整文档正文（从标题第一行到文档末尾）：\n" + formatIssues(issues),
        "## 当前产物\n" + str(artifact),
        "## 修正要求（严格遵守）\n" +
          "1. 直接输出修正后的完整文档正文，从文档标题第一行开始。\n" +
          "2. 不要输出「修正清单」「我做了哪些改动」之类的说明文字。\n" +
          "3. 不要保留旧版本，不要新旧并列，不要重复内容。\n" +
          "4. 不要输出 `<think>`、`</think>` 等标签或任何元信息。\n" +
          "5. 只针对审查问题做必要修正，不要从头重写整篇文档。",
      ]
        .filter(Boolean)
        .join("\n\n"),
  })

  ctx.log(`[Design] 完成：通过=${step3.passed}，轮次=${step3.rounds}`)

  // ── 产出落盘（消费 ctx.config.outputPath，R6.4/R6.5；问题 8 修复：框架 ctx.writeFile 直写）──
  // 文档内容本就是脚本进程内存里的字符串（step3.artifact），由框架 ctx.writeFile 确定性写盘
  // （零 token、瞬时、可靠，父目录自动 mkdir -p），消除「让 LLM 逐字复写大文档」导致的
  // 卡死/截断/改写。脚本无需 import，保持自包含。为 null：跳过并照常返回。
  if (__outputPath) {
    try {
      await ctx.writeFile(__outputPath, str(step3.artifact))
      ctx.log(`[Design] 落盘成功 → ${__outputPath}`)
    } catch (e) {
      ctx.log(`[Design] ⚠ 落盘失败：${e && e.message ? e.message : String(e)}`)
    }
  } else {
    ctx.log(`[Design] 未配置 outputPath，跳过落盘`)
  }

  // 返回结构化产物（DD6：调试期保留 steps 全量，对齐 prd D8），供串联时作为上游摘要传入下一阶段。
  return {
    phase: "design",
    feature,
    passed: step3.passed,
    rounds: step3.rounds,
    unresolved: step3.issues,
    document: step3.artifact,
    outputPath: __outputPath || null,
    steps: { step1, step2, step3 },
  }
}
