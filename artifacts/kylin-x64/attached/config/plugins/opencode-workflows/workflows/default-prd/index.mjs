/**
 * default-prd Workflow —— 产品需求文档(PRD)阶段（内置、完全独立可运行）。
 *
 * 「金标准原则」重写（scaffold-branches-multigate 任务 4.2）：本脚本只用 `renderScript`
 * 能生成的写法，使手写 `.mjs` 与「向导走一遍 → renderScript 生成」的脚本结构一致。
 *
 * 定位（default-prd 优化 D1）：产出**纯 PRD（产品需求文档）**——聚焦「做什么/为谁做/为什么」，
 * 不产出技术方案（概要/详细设计交给 default-design）。
 *
 * 编排形态（与脚手架产物同构）：
 *   异构并行检索步（`branches`：模板读取/规约检索/代码库分析，合并为命名 section 字符串）
 *   → PRD 文档生成（single，先大纲后成文，usePrev 接力检索上下文，required 关键步）
 *   → PRD 审查多维门控（`runMultiGate`：模板遵循/规约遵循/自定义）→ 产出落盘 → 完成。
 *
 * 关键设计：
 * - **完全独立**：内联 `str / parseVerdict / formatIssues / runStopGate / runMultiGate`,
 *   不 import 任何 `_lib` 共享库或同级 `default-*` 脚本（允许代码重复，金标准取舍）。
 * - **branches 异构检索**：经 `ctx.parallel` 并发执行三路各自独立 intent/useConfig/agentType 的分支，
 *   仅首分支接力上游摘要，结果合并为 `=== <label> ===` 命名 section 字符串供下游 usePrev 接力。
 *   各路输出契约（D2/D3）：无配置→返回 `[无模板]`/`[无规约]`；有配置→结构化要点 + 原文绝对路径，下游按需 read。
 * - **先大纲后成文（D4）**：原独立「任务规划」步已合并进文档生成——文档生成 agent 先产 PRD 大纲再据其展开。
 * - **runMultiGate 多维门控**：对产物并发执行 N 维审查（无 schema，自由文本 + 末行判定），任一不过即整体不过，
 *   针对失败维度修正接力、增量重审、轮次耗尽降级保留产物，null/不可解析维度标「不可评估」不消耗修正轮次。
 *   配置感知（问题 10）：各维度对照各自来源（模板遵循→template、规约遵循→rules、自定义→review）；未配置对应
 *   资源的维度【无对照基准 → 直接判定通过、不审查、不挑问题、不调工具】，不再用通用/内置基准凭空审查。
 * - **落盘 A 方案（D7→问题 8 修复）**：产出由框架 `ctx.writeFile` 直接写盘，不再让 LLM 逐字复写——零 token、瞬时、可靠，消除大文档 LLM 复写卡死/截断；脚本无需 import 保持自包含。
 * - **消费 ctx.config.resources**：`template/rules/review` 为绝对路径数组——非空时拼入对应步骤
 *   prompt（指示子 Agent 用 `read` 工具读取），空数组时该引导片段求值为空串被剔除。
 *
 * 独立运行：`/workflows-run` → 选 `default-prd` → 输入 feature。
 * 也可被其他 workflow 经 `ctx.workflow("default-prd", args)` 内联串联。
 *
 * args（可选）：{ feature?: string, upstreamSummary?: string }
 *
 * 审查门控最大轮次由配置驱动：`ctx.config.maxReviewRounds`（经 `<name>.config.json` 的
 * `max_review_rounds` 解析，缺省 3、钳制 [1,10]），不再硬编码、不再读 `args.maxReviewRounds`。
 *
 * _Requirements: 10.1, 10.5, 10.6_
 */

export const meta = {
  name: "default-prd",
  description: "PRD 阶段：异构并行检索（branches）→ 产品需求文档(PRD)生成（先大纲后成文）→ 多维审查门控（runMultiGate）→ 产出落盘",
  whenToUse: "需要把原始想法/需求整理成结构化产品需求文档(PRD)时（聚焦做什么/为谁/为什么，不含技术方案）",
  phases: [{ title: "PRD" }],
  outputName: "产品需求文档",
}

// ============================================================================
// 内联辅助符号（与 renderScript 注入产物同构，使本脚本完全独立）
// ============================================================================

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

/** Ralph Loop / stop-gate（DSL 控制流）：门控未过则修正重跑，直至通过或轮次耗尽后降级。 */
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

// ============================================================================
// execute —— workflow 主体
// ============================================================================

export default async function execute(ctx) {
  const args = ctx.args || {}
  const feature = args.feature || "当前需求"

  // ── per-phase 配置 shim：从 ctx.config 的 per-phase 字段提取本阶段（PRD）配置 ──
  const __PHASE = "PRD"
  const __res = ctx.config.resourcesByPhase?.[__PHASE] ?? {}
  const __outputPath = ctx.config.outputPathByPhase?.[__PHASE] ?? null
  const __maxRounds = ctx.config.maxReviewRoundsByPhase?.[__PHASE] ?? 3

  // 可选：为子 Agent 指定自定义 Agent 类型（agentType，子 Agent 调用的可选选项字段）。
  // 未设置时由框架按默认 Agent 类型执行；如需指定，在步骤里选择执行 Agent（仅 subagent/all）。

  // ── 消费配置（per-phase resources）：各类别为绝对路径数组，由 read 工具按需读取 ──
  const __cats = ["template", "rules", "review"]
  ctx.log("[default-prd] 配置 → " + __cats.map((c) => c + ":" + ((__res[c]) || []).length).join(" / ") + " / 落盘 " + (__outputPath || "(未配置)"))

  ctx.phase("PRD")

  // ── 异构并行检索步（branches）：模板读取 / 规约检索 / 代码库分析，合并为命名 section 字符串 ──
  // 输出契约（D2/D3）：无配置→固定占位；有配置→结构化要点 + 原文绝对路径（下游按需 read 取细节）。
  // 仅首分支接力上游摘要（与脚手架 branches 首分支接力上游同形）。
  const parts_step1 = await ctx.parallel([
    () => ctx.agent((__res["template"] ?? []).length ? ["你的任务：提炼 PRD 文档模板的【章节结构】与【每章写作要求】，供下游 PRD 文档生成 agent 遵循。", "模板原文路径（务必先用 read 工具读取其内容后再提炼）：\n" + (__res["template"] ?? []).join("\n") + "\n输出要求：① 逐条列出章节标题及层级；② 每个章节用一句话说明写作要求/应包含内容；③ 末尾原样附上上述模板原文路径，并注明「下游如需完整细节可 read 此路径」。", (args.upstreamSummary ? "上游上下文（上一步结果）：\n" + str(args.upstreamSummary) : "")].filter(Boolean).join("\n\n") : "本步骤未配置 PRD 文档模板。直接输出一行 `[无模板]` 并结束；禁止调用任何工具去查找/检索/猜测模板，禁止臆造章节结构。", { label: "模板读取", phase: "PRD", required: true }),
    () => ctx.agent((__res["rules"] ?? []).length ? ["你的任务：检索并提炼与本需求相关的【工程规约/约束要点】，供下游遵循。", "规约原文路径（务必先用 read 工具读取其内容后再提炼）：\n" + (__res["rules"] ?? []).join("\n") + "\n输出要求：① 以要点清单列出适用于本需求的规约条目；② 末尾原样附上上述规约原文路径，并注明「下游如需完整细节可 read 此路径」。"].join("\n\n") : "本步骤未配置工程规约文档。直接输出一行 `[无规约]` 并结束；禁止调用任何工具去查找/检索/列举规约，禁止编造规约。", { label: "规约检索", phase: "PRD", required: true }),
    () => ctx.agent(["你是只读代码探索 agent（READ-ONLY），擅长快速导航与分析代码库。仅使用 grep/glob/read 与只读 shell（ls、git status/log/diff、cat、head、tail）定位和分析【代码】。", "严禁：创建/修改/删除/移动任何文件、用重定向或 heredoc 写盘、执行任何改变系统状态的命令——本步是纯只读探索，你没有写权限。", "任务：分析当前代码库的结构与现有实现模式（现有功能、模块/目录划分、关键源码文件、技术栈与约定），为下游 PRD 生成提供「现有系统现状」参考。返回目录结构摘要 + 关键【源码】文件清单（含路径，供下游按需 read）。", "边界：聚焦【代码】本身。不要把 README、docs、spec、规约、审查清单、设计文档等文档/规范类文件当作「关键文件」或规范依据纳入——规范来源由配置（模板/规约）显式提供，本步只反映代码现状，不替下游决定遵循哪些规范。", "将发现作为普通消息直接汇报，不要创建任何文件。"].join("\n\n"), { label: "代码库分析", phase: "PRD", required: true }),
  ])
  const step1 = ["模板读取", "规约检索", "代码库分析"]
    .map((t, i) => "=== " + t + " ===\n" + str(parts_step1[i]))
    .join("\n\n")

  // ── PRD 文档生成（single，先大纲后成文，usePrev 接力检索上下文，required 关键步）──
  // 合并原「任务规划」步（D4）：先产 PRD 大纲再据其展开为完整 PRD。
  const prompt_step2 = [
    "你是产品经理。请基于上游检索上下文，为「" + feature + "」编写一份结构化的【产品需求文档(PRD)】。",
    "PRD 聚焦「做什么 / 为谁做 / 为什么」，不写技术实现方案（技术方案属后续设计阶段）。",
    "请先核验所需输入与前提是否就绪（缺失则在文档中显式标注假设）；再【先输出 PRD 大纲（章节列表）】，随后据大纲逐节展开为完整、可交付的 PRD。",
    "若上游提供了文档模板章节结构，严格遵循其章节结构与各章节写作要求。",
    "上游上下文（检索结果）：\n" + str(step1),
    "## 交付约束（严格遵守）\n" +
      "1. **你的唯一交付方式**：把文档正文作为本次回复的【纯文本内容】返回，从文档标题第一行开始到文档末尾，不要任何前言或后续操作说明。\n" +
      "2. **禁止调用写文件工具**（如 fs_write、str_replace 等）：文件落盘由工作流框架负责，你无需也不应自行写盘。\n" +
      "3. **回复纯净性**：回复中只允许出现文档正文本身，不要输出 `<think>`、`<reflection>` 等标签，不要「已写入文件」之类的操作确认，不要任何对文档的说明或摘要。\n" +
      "4. **完整性**：必须包含大纲展开后的所有章节完整内容，不能只返回大纲或部分章节。",
  ].filter(Boolean).join("\n\n")
  const step2 = await ctx.agent(prompt_step2, { label: "PRD 文档生成", phase: "PRD", required: true })

  // ── PRD 审查多维门控（runMultiGate，D5 维度不变）：模板遵循 / 规约遵循 / 自定义 ──
  // 配置感知（与检索阶段对称）：各维度对照各自来源（模板遵循→template、规约遵循→rules、自定义→review）；
  // 未配置对应资源时该维度【无对照基准 → 直接判定通过、不审查、不挑问题、不调工具】（问题 10，方案 2）：
  // 不再用"通用/内置基准"凭空审查，避免名不副实的臆造挑刺触发无谓修正轮次。
  const __tpl = __res["template"] ?? []
  const __rules = __res["rules"] ?? []
  const __review = __res["review"] ?? []
  const __verdict = "请审查以下产物。先逐条列出存在的问题（无问题则说明已通过），最后在末行输出判定：`判定: 通过` 或 `判定: 不通过`。\n\n## 待审查产物\n"
  // 未配置维度的「直接判过」指令（无对照基准则不审；含「末行输出判定」与「判定: 通过」字样，
  // 供 parseVerdict 解析、并被审查识别为门控调用——它仍是一个审查维度，只是指示直接判过）。
  const __skip = (cat) => "本阶段未配置" + cat + "：本维度无对照基准、无需审查。请直接在末行输出判定：`判定: 通过`，不要列出任何问题，也不要调用任何工具。"
  const step3 = await runMultiGate(ctx, {
    phaseTitle: "PRD",
    maxRounds: __maxRounds,
    artifact: step2,
    dimensions: [
      { name: "模板遵循", prompt: (artifact) => __tpl.length ? ["审查 PRD 文档是否遵循模板的章节结构与格式；请先用 read 工具读取以下模板原文再对照：\n" + __tpl.join("\n"), __verdict + str(artifact)].join("\n\n") : __skip("PRD 文档模板（template）") },
      { name: "规约遵循", prompt: (artifact) => __rules.length ? ["审查 PRD 文档是否遵循工程规约与约束；请先用 read 工具读取以下规约原文再对照：\n" + __rules.join("\n"), __verdict + str(artifact)].join("\n\n") : __skip("工程规约（rules）") },
      { name: "自定义", prompt: (artifact) => __review.length ? ["请对照以下审查清单审查 PRD 文档（先用 read 工具读取其内容）：\n" + __review.join("\n"), __verdict + str(artifact)].join("\n\n") : __skip("审查清单（review）") },
    ],
    fixPrompt: (artifact, issues) => [
      "针对以下审查问题修正当前文档，直接返回修正后的完整文档正文（从标题第一行到文档末尾）：\n" + formatIssues(issues),
      "## 当前产物\n" + str(artifact),
      "## 修正要求（严格遵守）\n" +
        "1. 直接输出修正后的完整文档正文，从文档标题第一行开始。\n" +
        "2. 不要输出「修正清单」「我做了哪些改动」之类的说明文字。\n" +
        "3. 不要保留旧版本，不要新旧并列，不要重复内容。\n" +
        "4. 不要输出 `<think>`、`</think>` 等标签或任何元信息。\n" +
        "5. 只针对审查问题做必要修正，不要从头重写整篇文档。"
    ].filter(Boolean).join("\n\n"),
  })

  ctx.log("[default-prd] 完成：通过=" + step3.passed + "，轮次=" + step3.rounds)

  // ── 产出落盘（消费 ctx.config.outputPath；A 方案：框架 ctx.writeFile 直写）──
  // 文档内容本就是脚本进程内存里的字符串（step3.artifact），由框架 ctx.writeFile 确定性写盘
  // （零 token、瞬时、可靠，父目录自动 mkdir -p），彻底消除「让 LLM 逐字复写大文档」导致的
  // 卡死/截断/改写（问题 8 根因 1）。脚本无需 import，保持自包含。
  if (__outputPath) {
    try {
      await ctx.writeFile(__outputPath, str(step3.artifact))
      ctx.log("[default-prd] 落盘成功：" + __outputPath)
    } catch (e) {
      ctx.log("[default-prd] ⚠ 落盘失败：" + (e && e.message ? e.message : String(e)))
    }
  } else {
    ctx.log("[default-prd] 未配置 outputPath，跳过落盘")
  }

  // 返回结构化产物，供串联时作为上游摘要传入下一阶段（D8：调试期暂不精简，保留 steps 全量）。
  return {
    phase: "prd",
    feature,
    passed: step3.passed,
    rounds: step3.rounds,
    unresolved: step3.issues,
    document: step3.artifact,
    outputPath: __outputPath || null,
    steps: { step1, step2, step3 },
  }
}
