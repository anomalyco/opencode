/**
 * default-code Workflow —— TDD 代码实现阶段（完全独立、可单独编辑、可单独运行）。
 *
 * 本脚本以「金标准原则」重写：只使用脚手架 `renderScript` 能生成的写法，使手写 `.mjs` 与
 * 「向导走一遍 → renderScript 生成」的脚本结构一致（scaffold-branches-multigate，任务 4.4）。
 *
 * 编排形态（与脚手架产物同构）：
 *   异构并行检索（branches）→ 环境核验+编码规划 → TDD 红灯(测试先行) → 代码实现
 *   → TDD 绿灯(单维门控 runStopGate) → 代码审查(多维门控 runMultiGate) → 完成。
 *
 * - **检索步（branches 异构并行）**：模板读取 / 规约检索 / 代码库分析三路并发，各自独立
 *   intent/useConfig/agentType，合并为命名 section 字符串供下游 usePrev 接力；上游设计契约
 *   经首分支接力并入检索上下文。输出契约（DD4，对齐 prd D2/D3）：无配置→`[无模板]`/`[无规约]` +
 *   终止 + 禁检索；有配置→结构化要点 + 原文路径（下游按需 read）；代码库分析为只读探索（READ-ONLY，
 *   不写盘、不把 docs/spec/规约/设计文档当关键文件）。
 * - **TDD 绿灯（单维门控）**：runStopGate —— 运行测试，失败则修正实现代码（不改测试），
 *   直至全绿或轮次耗尽降级。
 * - **代码审查（多维门控）**：runMultiGate —— 规约 / 需求符合性 / 自定义 三维度并发审查，
 *   任一不过即整体不过，针对失败维度修正后增量重审，轮次耗尽降级。
 *   配置感知（对齐 prd §16 方案 2 / design DD3）：各维度对照各自来源（规约→rules、自定义→review），
 *   未配置对应资源的维度【无对照基准 → 直接判过、不审、不塞产物、不调工具】；「需求符合性」对照
 *   可得的需求/设计依据（feature + upstream，feature 恒在）恒审、自适应输入粒度（有详细设计对设计、
 *   否则对需求）。「测试覆盖与质量」维度已删除——TDD 绿灯已保证测试通过，覆盖率/覆盖完整性归 Test 阶段。
 *
 * **数据流改进（A3，修复问题 ①②④⑥）**：采用 useSteps 具名多上游引用，让关键步骤同时获得
 * 设计契约、任务清单、测试索引等上游依据，而非链式单步接力导致的依据丢失。step2 物化设计契约
 * 回显作为可被引用的依据锚；step4 实现同时引用 step2(设计+任务清单) + step3(测试索引)；
 * 门控组合多上游产物作为 artifact。
 *
 * 输入契约：feature 接受任意粒度（一句话需求 / PRD / 详细设计文档路径 / 上游 upstream 摘要）；
 * step2/3/4 自适应——含文档路径先 read，有设计依设计、仅需求则据需求轻量推导，不臆造/扩大需求。
 *
 * 环境核验 / 分段写入 / 只读分工降为步骤 intent 或 agentType 表达，不引入新原语（R10.6）。
 *
 * `meta` 为纯字面量，可被 ScriptLoader.extractMeta 静态提取（不触发 META_INVALID，R10.5）。
 *
 * 独立运行：`/workflows-run default-code`。也可被上游 workflow 经
 * `ctx.workflow("default-code", { upstreamSummary })` 串联。
 *
 * args（可选）：{ feature?: string, upstreamSummary?: string }
 *
 * _Requirements: 10.3, 10.5, 10.6_
 */

// ─────────────────────────────────────────────────────────────────────────────
// 内联辅助（与 renderScript 注入的 str / 门控 / 多维门控 helper 同构）
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

// ─────────────────────────────────────────────────────────────────────────────
// meta（纯字面量，供 ScriptLoader.extractMeta 静态提取）
// ─────────────────────────────────────────────────────────────────────────────

export const meta = {
  name: "default-code",
  description: "Code 阶段：异构并行检索 → 环境核验+编码规划 → TDD 红灯 → 实现 → TDD 绿灯(单维门控) → 代码审查(多维门控)",
  whenToUse: "已有需求（一句话需求 / PRD / 详细设计均可），需要按 TDD 流程实现代码并经测试验证与多维代码审查时",
  phases: [{ title: "Code" }],
}

export default async function execute(ctx) {
  const args = ctx.args || {}
  const feature = args.feature || "当前需求"
  const upstream = args.upstreamSummary || "（未提供上游设计摘要）"

  // ── per-phase 配置 shim：从 ctx.config 的 per-phase 字段提取本阶段（Code）配置 ──
  const __PHASE = "Code"
  const __res = ctx.config.resourcesByPhase?.[__PHASE] ?? {}
  const __outputPath = ctx.config.outputPathByPhase?.[__PHASE] ?? null
  const __maxRounds = ctx.config.maxReviewRoundsByPhase?.[__PHASE] ?? 3

  ctx.phase("Code")

  // ── 异构并行检索（branches）：模板读取 / 规约检索 / 代码库分析；上游设计契约经首分支接力 ──
  // 输出契约（DD4，对齐 prd D2/D3/§8.2）：无配置→固定占位 + 终止 + 禁检索；有配置→结构化要点 + 原文路径（下游按需 read）。
  const parts_step1 = await ctx.parallel([
    () =>
      ctx.agent(
        (__res["template"] ?? []).length
          ? [
              "你的任务：提炼 Code 阶段编码模板的【章节结构/约定要点】，供下游编码遵循。",
              "模板原文路径（务必先用 read 工具读取其内容后再提炼）：\n" +
                (__res["template"] ?? []).join("\n") +
                "\n输出要求：① 逐条列出模板要点/约定；② 末尾原样附上上述模板原文路径，并注明「下游如需完整细节可 read 此路径」。",
              "上游设计契约（须遵循，作为实现依据）：\n" + str(upstream),
            ].filter(Boolean).join("\n\n")
          : [
              "本步骤未配置编码模板。直接输出一行 `[无模板]`；禁止调用任何工具去查找/检索/猜测模板，禁止臆造模板约定。",
              "上游设计契约（须遵循，作为实现依据）：\n" + str(upstream),
            ].filter(Boolean).join("\n\n"),
        { label: "模板读取", phase: "Code", required: true },
      ),
    () =>
      ctx.agent(
        (__res["rules"] ?? []).length
          ? [
              "你的任务：检索并提炼与本需求相关的【工程规约/编码约束要点】，供下游遵循。",
              "规约原文路径（务必先用 read 工具读取其内容后再提炼）：\n" +
                (__res["rules"] ?? []).join("\n") +
                "\n输出要求：① 以要点清单列出适用于本需求的规约条目；② 末尾原样附上上述规约原文路径，并注明「下游如需完整细节可 read 此路径」。",
            ].join("\n\n")
          : "本步骤未配置工程规约文档。直接输出一行 `[无规约]` 并结束；禁止调用任何工具去查找/检索/列举规约，禁止编造规约。",
        { label: "规约检索", phase: "Code", required: true },
      ),
    () =>
      ctx.agent(
        [
          "你是只读代码探索 agent（READ-ONLY），擅长快速导航与分析代码库。仅使用 grep/glob/read 与只读 shell（ls、git status/log/diff、cat、head、tail）定位和分析【代码】。",
          "严禁：创建/修改/删除/移动任何文件、用重定向或 heredoc 写盘、执行任何改变系统状态的命令——本步是纯只读探索，你没有写权限。",
          "任务：分析当前代码库的结构与现有实现模式（现有功能、模块/目录划分、关键源码文件、技术栈与约定、可复用接口），为下游编码提供「现有系统现状」参考。返回目录结构摘要 + 关键【源码】文件清单（含路径，供下游按需 read）。",
          "边界：聚焦【代码】本身。不要把 README、docs、spec、规约、审查清单、设计文档等文档/规范类文件当作「关键文件」或规范依据纳入——规范来源由配置（模板/规约）显式提供，本步只反映代码现状，不替下游决定遵循哪些规范。",
          "将发现作为普通消息直接汇报，不要创建任何文件。",
        ].join("\n\n"),
        { label: "代码库分析", phase: "Code", required: true },
      ),
  ])
  const step1 = ["模板读取", "规约检索", "代码库分析"]
    .map((t, i) => "=== " + t + " ===\n" + str(parts_step1[i]))
    .join("\n\n")

  // ── 环境核验 + 编码规划（环境核验降为 intent 表达，不引入新原语）──
  // B1-1/2/3：输入粒度自适应 + read 引导 + 无设计行为约束（feature 可为一句话需求/PRD/详细设计）。
  // A3：物化设计契约回显作为依据锚（供 step3/4/6 通过 useSteps 引用，修复问题 ①④⑧）。
  const prompt_step2 =
    [
      "先核验项目语言/运行时/构建工具/测试框架与已有代码及测试的可用性，记录于计划开头。" +
        "核验方式：**先据项目清单文件（如 package.json / pom.xml / build.gradle / requirements.txt / pyproject.toml / Cargo.toml 等）判定语言与工具链，再实际运行对应生态的版本/可用性探测命令，以真实命令输出为准，不得凭推断判断是否已安装**；" +
        "命令按识别到的语言自行选择（例如不限于 node -v、mvn -v、pytest --version）；确实无法运行探测的项才显式标注「未确认」，不要主观臆断「待安装」。",
      "需求/设计依据：本次运行输入（feature）即需求，可能是一句话需求、需求文档/PRD 或详细设计文档；" +
        "若其中包含文档路径，请先用 read 工具读取其内容作为依据，不要臆造需求。" +
        "按可得的最高保真依据执行——有详细设计则依其接口/数据结构/业务规则；仅有需求则基于需求做必要的轻量设计判断后再编码，缺失关键点显式标注假设，不得臆造或扩大需求范围。",
      "再基于检索上下文与上述依据为「" + feature + "」生成 TDD 任务清单（每功能：[红灯]写测试→[绿灯]实现→[重构]）。",
      "**返回格式**：① 环境核验结果；② 读到的设计契约/需求要点（若 feature 含路径则 read 后回显要点，作为下游依据锚）；③ TDD 任务清单（含任务编号、描述、测试/实现/重构标记）。",
      "上游设计摘要（串联运行时提供，独立运行可能为空占位）：\n" + str(upstream),
      "上游上下文（上一步结果）：\n" + str(step1),
    ].filter(Boolean).join("\n\n")
  const step2 = await ctx.agent(prompt_step2, { label: "环境核验+编码规划", phase: "Code", required: true })

  // ── TDD 红灯：先写测试，运行并确认全部 FAIL ──
  // A3：接 step2（含设计契约回显 + 任务清单），红灯据真实设计依据写测试（修复问题 ①）。
  const prompt_step3 =
    [
      "TDD 红灯阶段：依据可得的需求/设计依据（如有详细设计则据其接口/数据结构/业务规则/边界条件；" +
        "若仅有需求则据需求合理推导边界，不臆造需求），为 [红灯] 任务编写测试用例（不重写已有测试），" +
        "运行并确认全部 FAIL，返回已写测试摘要。",
      "返回时请附上本次已写/已改的【测试文件路径清单】+ 简要说明（不复述全部代码），供下游 read 定位真实文件。",
      "上游上下文（上一步结果）：\n" + str(step2),
    ].filter(Boolean).join("\n\n")
  const step3 = await ctx.agent(prompt_step3, { label: "TDD 红灯(测试先行)", phase: "Code", required: true })

  // ── 代码实现：只实现 [绿灯] 任务，不改测试（只读/只写分工降为 intent 表达）──
  // A3：useSteps 具名多上游引用 —— 同时引用 step2(设计+任务清单) + step3(测试索引)，
  //     使实现同时拿到设计依据、任务清单与测试索引，而非只接紧邻上一步的测试清单摘要（修复问题 ①④）。
  const prompt_step4 =
    [
      "代码实现阶段：只实现 [绿灯] 标记的新增任务，不重写已有代码、不修改测试文件，遵循工程规约；" +
        "本阶段只写实现不运行测试，返回实现摘要。",
      "实现依据：以「环境核验+编码规划」section 的设计契约/任务清单为功能依据，以「TDD 红灯」section 的测试文件清单为验收目标（按需 read 测试文件正文确认契约），二者结合实现。",
      "返回时请附上本次已写/已改的【实现文件路径清单】+ 简要说明（不复述全部代码），供下游 read 定位真实文件。",
      "上游上下文：\n" +
        [
          "=== 环境核验+编码规划 ===\n" + str(step2),
          "=== TDD 红灯(测试先行) ===\n" + str(step3),
        ].join("\n\n"),
    ].filter(Boolean).join("\n\n")
  const step4 = await ctx.agent(prompt_step4, { label: "代码实现", phase: "Code", required: true })

  // ── TDD 绿灯：单维门控 runStopGate（失败→修正实现，不改测试）──
  // B2-B：门控对象拉回「磁盘真实代码 + 真实测试运行」——摘要仅供定位，以真实运行结果为准。
  // A3：组合 step3(测试索引) + step4(实现索引) 作为 artifact，使门控同时见测试与实现（修复问题 ②）。
  const __artifact_step5 = [
    "=== 已写测试(TDD 红灯) ===\n" + str(step3),
    "=== 实现(代码实现) ===\n" + str(step4),
  ].join("\n\n")
  const step5 = await runStopGate(ctx, {
    phaseTitle: "Code",
    maxRounds: __maxRounds,
    artifact: __artifact_step5,
    label: "TDD 绿灯(测试验证)",
    gatePrompt: (artifact) =>
      [
        "TDD 绿灯·测试验证：请按下述步骤判定，**以真实运行结果为准，不要仅凭下方摘要**：",
        "① 先用 read/glob 确认本次实现与测试文件的真实磁盘状态；② 真实运行完整测试套件（bash/test 工具）；③ 依据真实测试结果判断是否全部 PASS（覆盖率检查留待 Test 阶段）。下方摘要/文件清单仅供定位真实文件。",
        "先逐条列出存在的问题（无问题则说明已通过），最后在末行输出判定：`判定: 通过` 或 `判定: 不通过`。\n\n## 待审查产物（仅供定位，以磁盘真实代码与真实测试结果为准）\n" + str(artifact),
      ].filter(Boolean).join("\n\n"),
    fixPrompt: (artifact, issues) =>
      [
        "只针对以下测试失败问题修正（不从头重写）：先用 read 读取相关实现文件的真实现状，再就地修正磁盘实现文件（write/edit，不修改测试文件），并重新运行测试确认：\n" + formatIssues(issues),
        "修正后返回本次【修改的文件路径清单】+ 简要说明（不复述全部代码）。",
        "## 当前产物（仅供定位）\n" + str(artifact),
      ].filter(Boolean).join("\n\n"),
  })

  // ── 代码审查：多维门控 runMultiGate（规约 / 需求符合性 / 自定义）──
  // 配置感知（对齐 prd §16 方案 2 / design DD3）：各维度对照各自来源（规约→rules、自定义→review）；
  // 未配置对应资源的维度【无对照基准 → 直接判过、不审、不塞产物、不调工具】。
  // 「需求符合性」对照可得的需求/设计依据（feature + upstream，feature 恒在），恒审、自适应输入粒度。
  // 「测试覆盖与质量」维度已删除：TDD 绿灯已保证测试通过，覆盖率/覆盖完整性归 Test 阶段（避免职责越界与冗余）。
  // A3：组合 step2(设计) + step3(测试) + step4(实现) 作为 artifact，使审查同时见全部上游产物，
  //     而非双层 JSON 包裹的门控结果对象（修复问题 ⑥）。
  const __rules = __res["rules"] ?? []
  const __review = __res["review"] ?? []
  const __verdict = "审查前请先用 read/grep/glob 读取本次涉及的真实源码与测试文件再判定，**以磁盘真实代码为准**；下方产物/文件清单仅供定位。先逐条列出存在的问题（无问题则说明已通过），最后在末行输出判定：`判定: 通过` 或 `判定: 不通过`。\n\n## 待审查产物（仅供定位）\n"
  const __skip = (cat) => "本阶段未配置" + cat + "：本维度无对照基准、无需审查。请直接在末行输出判定：`判定: 通过`，不要列出任何问题，也不要调用任何工具。"
  const __artifact_step6 = [
    "=== 设计依据(环境核验+编码规划) ===\n" + str(step2),
    "=== 测试(TDD 红灯) ===\n" + str(step3),
    "=== 实现(代码实现) ===\n" + str(step4),
  ].join("\n\n")
  const step6 = await runMultiGate(ctx, {
    phaseTitle: "Code",
    maxRounds: __maxRounds,
    artifact: __artifact_step6,
    dimensions: [
      {
        name: "规约",
        prompt: (artifact) =>
          __rules.length
            ? [
                "审查已实现代码是否遵循工程规约与编码约束；请先用 read 工具读取以下规约原文再对照：\n" + __rules.join("\n"),
                __verdict + str(artifact),
              ].join("\n\n")
            : __skip("工程规约（rules）"),
      },
      {
        name: "需求符合性",
        prompt: (artifact) =>
          [
            "审查已实现代码是否覆盖并符合需求/设计依据：是否实现了需求（或详细设计）描述的全部功能、与之保持一致、无遗漏无偏离。",
            "需求/设计依据（feature）：" + feature,
            "## 上游设计摘要（串联时提供，独立运行可能为空占位）\n" + str(upstream),
            "若上述依据中包含需求/设计文档路径，请先用 read 工具读取其内容作为对照基准——有详细设计则对照设计，否则对照需求本身。",
            __verdict + str(artifact),
          ].filter(Boolean).join("\n\n"),
      },
      {
        name: "自定义",
        prompt: (artifact) =>
          __review.length
            ? [
                "请对照以下审查清单审查已实现代码（先用 read 工具读取其内容）：\n" + __review.join("\n"),
                __verdict + str(artifact),
              ].join("\n\n")
            : __skip("审查清单（review）"),
      },
    ],
    fixPrompt: (artifact, issues) =>
      [
        "只针对以下分维度审查问题修正（不从头重写）：先用 read 读取相关源码的真实现状，再就地修正磁盘文件（write/edit），遵循工程规约：\n" + formatIssues(issues),
        "修正后返回本次【修改的文件路径清单】+ 简要说明（不复述全部代码）。",
        "## 当前产物（仅供定位）\n" + str(artifact),
      ].filter(Boolean).join("\n\n"),
  })

  ctx.log("[Code] 完成：测试通过=" + step5.passed + "，审查通过=" + step6.passed)

  // 返回结构化产物（与 default-prd/design/test 同构：phase + 通过标志 + 未解决问题）。
  return {
    phase: "code",
    feature,
    testsPassed: step5.passed,
    reviewPassed: step6.passed,
    rounds: { tests: step5.rounds, review: step6.rounds },
    unresolved: [...step5.issues, ...step6.issues],
    steps: { step1, step2, step3, step4, step5, step6 },
  }
}
