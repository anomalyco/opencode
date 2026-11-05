/**
 * OpenCode Workflows —— WorkflowScaffolder：引导式脚本生成纯逻辑（无副作用、可独立测试）。
 *
 * 把 Studio「新建」向导的「问答 → 脚本文本」纯逻辑从 TUI JSX/对话框编排中抽离为
 * 无副作用纯函数，便于属性/单元测试（不依赖真实对话框与文件系统）。
 *
 * 本文件实现两个纯函数：`validateName`（任务 7.1）与 `renderScript`（任务 7.3，多步骨架渲染）。
 *
 * @see ../../.kiro/specs/workflow-enhancements/design.md — Components and Interfaces / 组件 3
 * @see ../../.kiro/specs/workflow-enhancements/design.md — 算法 4：引导式脚本名校验 validateName
 */

import type { NameValidation, ScaffoldAnswers, ScaffoldStep } from "../types"
import {
  runAdversarialHelperLines,
  runFinderLoopHelperLines,
  runJudgePanelHelperLines,
  verdictOnlyHelperLines,
} from "./quality-helpers"

// ============================================================================
// 常量
// ============================================================================

/** workflow 名称最大长度（字符数）。 */
const MAX_NAME_LENGTH = 64

/** kebab-case 校验：小写字母/数字段，以单个连字符分隔，无前后缀连字符与连续连字符。 */
const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** 内置命名空间保留前缀（区分大小写字面量）。 */
const RESERVED_PREFIX = "default-"

// ============================================================================
// 名称校验
// ============================================================================

/**
 * 校验 workflow 名：非空、≤64 字符、kebab-case、不以 `default-` 前缀开头、
 * 不与已注册名（内置 + 全局自定义）冲突。
 *
 * 校验顺序：非空 → 长度上限 → kebab-case 格式 → `default-` 前缀保留 → 重名。
 * 任一规则违反时返回 `{ ok: false, reason }`，`reason` 明确指出违反的具体规则
 * （满足 Requirement 8.3「明确指出违反哪一项」）；全部通过返回 `{ ok: true }`。
 *
 * 纯函数：仅读取入参，不产生副作用。
 *
 * @param name 待校验的名称（内部会先 trim 两端空白）。
 * @param registeredNames 已注册名集合（内置 `default-*` 与全局自定义）。
 * @returns 校验结果。
 *
 * Requirements: 1.2, 8.3
 */
export function validateName(name: string, registeredNames: ReadonlySet<string>): NameValidation {
  const n = (name ?? "").trim()
  if (n.length === 0) return { ok: false, reason: "名称不能为空" }
  if (n.length > MAX_NAME_LENGTH) return { ok: false, reason: `名称超过 ${MAX_NAME_LENGTH} 字符` }
  if (!KEBAB_CASE_RE.test(n)) return { ok: false, reason: "需为 kebab-case（小写字母数字与连字符）" }
  if (n.startsWith(RESERVED_PREFIX)) return { ok: false, reason: "default- 前缀为内置命名空间保留" }
  if (registeredNames.has(n)) return { ok: false, reason: `名称 "${n}" 已存在（内置或全局自定义）` }
  return { ok: true }
}

// ============================================================================
// M2: agentType=explore 的 READ-ONLY 5段模板（批次2）
// ============================================================================

/** explore agent READ-ONLY 约束的头部两段（①角色+工具 / ②严禁写盘）。 */
const EXPLORE_SEGMENTS_HEAD = [
  "你是只读代码探索 agent（READ-ONLY），擅长快速导航与分析代码库。仅使用 grep/glob/read 与只读 shell（ls、git status/log/diff、cat、head、tail）定位和分析【代码】。",
  "严禁：创建/修改/删除/移动任何文件、用重定向或 heredoc 写盘、执行任何改变系统状态的命令——本步是纯只读探索，你没有写权限。",
]

/** explore agent READ-ONLY 约束的尾部两段（④边界 / ⑤普通汇报）。 */
const EXPLORE_SEGMENTS_TAIL = [
  "边界：聚焦【代码】本身。不要把 README、docs、spec、规约、审查清单、设计文档等文档/规范类文件当作「关键文件」或规范依据纳入——规范来源由配置显式提供，本步只反映代码现状。",
  "将发现作为普通消息直接汇报，不要创建任何文件。",
]

/**
 * M2: 为 agentType=explore 的步骤/分支生成 READ-ONLY 包裹的 prompt 表达式。
 * 用户 intent 作为任务段（③），插入 HEAD 和 TAIL 之间；useConfig 引导片段照常拼接。
 */
function explorePromptExpr(intent: string, cfgParts: string[], prevExpr: string | null): string {
  // ①② HEAD 段 + ③ 用户 intent + useConfig 引导(若有) + prevExpr(若有) + ④⑤ TAIL 段
  const taskAndCfg = [q(intent), ...cfgParts, prevExpr].filter(Boolean)
  const allSegments = [
    ...EXPLORE_SEGMENTS_HEAD.map(q),
    ...taskAndCfg,
    ...EXPLORE_SEGMENTS_TAIL.map(q),
  ]
  return joinPartsExpr(allSegments)
}

/**
 * M1（批次3）：为有 useConfig 的步骤/分支生成配置感知 prompt 表达式。
 * - 无 useConfig → 返回普通 joinPartsExpr（逐字节兼容现状）
 * - 有 useConfig → 生成三元：所有类别都空→终止禁检索；任一非空→intent+契约+配置+prev
 * 
 * Phase 4: 添加 phase 参数，生成按阶段访问资源的代码
 */
function configAwarePromptExpr(
  intent: string,
  useConfig: string[] | undefined,
  phase: string,
  declaredLabels: Record<string, string>,
  prevExpr: string | null,
): string {
  // 无 useConfig：现有行为，逐字节不变
  if (!useConfig || useConfig.length === 0) {
    return joinPartsExpr([q(intent), prevExpr])
  }

  // 有 useConfig：配置感知三元
  // 判断条件：所有类别都为空才终止（任一非空则进有配置分支）
  // Phase 4: 按阶段检查资源是否存在
  const lengthChecks = useConfig
    .map((c) => `(ctx.config.resourcesByPhase?.[${q(phase)}]?.[${q(c)}] ?? []).length`)
    .join(" || ")

  // 有配置分支：intent + 各类别引导(配了的拼路径,没配的片段""被剔除) + 通用契约句 + prevExpr
  const cfgParts = configPartExprs({ useConfig } as ScaffoldStep, phase, declaredLabels)
  const contractText = "（请先用 read 读取上述原文后提炼结构化要点；末尾原样附上原文路径，注明「下游可 read 取细节」）"
  const haveExpr = joinPartsExpr([q(intent), ...cfgParts, q(contractText), prevExpr])

  // 无配置分支：终止禁检索（标记列出所有未配类别）
  const emptyMarker = `[无${useConfig.join("/")}]`
  const emptyText = `本步骤未配置「${useConfig.join("/")}」资源。直接输出一行 \`${emptyMarker}\` 并结束；禁止调用任何工具去查找/检索/猜测，禁止臆造。`
  const emptyExpr = q(emptyText)

  return `((${lengthChecks}) ? (${haveExpr}) : ${emptyExpr})`
}

// ============================================================================
// parseVerdict —— 门控判定解析器（wf-gate-loosening-and-fault-tolerance，任务 1.2）
// ============================================================================

/** parseVerdict 返回类型：门控自由文本解析结果。 */
export interface VerdictResult {
  /** 判定结果：命中「通过/pass」为 true；命中「不通过/fail」或不可评估为 false。 */
  passed: boolean
  /** 是否可评估：解析到合法判定行为 true；无判定行或空文本为 false。 */
  evaluable: boolean
  /** prose issues：成功解析且 passed=false 时为去判定行后的正文（非空时）；不可评估时为降级标记。 */
  issues: string[]
}

/**
 * 有界判定行正则（非全局，用于逐行 test/exec）：匹配中英双语判定词与全/半角冒号，
 * 捕获完整判定 token（`不通过`/`通过`/`fail`/`pass`），大小写不敏感。
 */
const VERDICT_RE = /(?:判定|verdict)\s*[:：]\s*(不通过|通过|fail|pass)/i

/** 不可评估降级标记文案。 */
const VERDICT_UNPARSEABLE = "判定不可解析"

/**
 * 从门控 Agent 自由文本输出解析末行判定（Verdict_Line），得到布尔判定与 prose issues。
 *
 * 纯函数、无副作用、有界正则（避免对模型任意畸形输出做无界猜测式解析）。
 *
 * 行为：
 * - `String(text ?? "")` 兜底；空/纯空白 → 直接返回不可评估降级。
 * - 按行从后向前找首个匹配 `VERDICT_RE` 的行作为判定行；无匹配 → 不可评估降级。
 * - 负向（`不通过`/`fail`）优先：同行歧义时 `passed=false`（宁可判不过，不可误放行）。
 * - prose 为去判定行后正文 trim；`passed=false` 且 prose 非空时入 issues。
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 *
 * @param text 门控 Agent 的自由文本输出。
 * @returns 判定结果 `{ passed, evaluable, issues }`。
 */
export function parseVerdict(text: unknown): VerdictResult {
  const s = String(text ?? "")
  if (s.trim().length === 0) {
    return { passed: false, evaluable: false, issues: [VERDICT_UNPARSEABLE] }
  }
  const lines = s.split(/\r?\n/)
  let verdictIdx = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (VERDICT_RE.test(lines[i]!)) {
      verdictIdx = i
      break
    }
  }
  if (verdictIdx < 0) {
    return { passed: false, evaluable: false, issues: [VERDICT_UNPARSEABLE] }
  }
  // 负向优先：同行歧义（含「通过」与「不通过」/含 pass 与 fail）时判不过。
  const verdictLine = lines[verdictIdx]!
  const negative = /不通过/.test(verdictLine) || /\bfail\b/i.test(verdictLine)
  const m = VERDICT_RE.exec(verdictLine)
  const token = (m && m[1] ? m[1] : "").toLowerCase()
  const positive = token === "通过" || token === "pass"
  const passed = !negative && positive
  const prose = lines
    .filter((_, i) => i !== verdictIdx)
    .join("\n")
    .trim()
  return { passed, evaluable: true, issues: passed ? [] : prose ? [prose] : [] }
}

/**
 * 把 issues 数组格式化为编号清单文本（供 fixPrompt 使用）。保留运行时纯函数形态，
 * 与脚本注入模板（gateHelperLines）保持语义一致。
 *
 * @param issues issues 数组。
 * @returns 编号清单文本；空数组返回 `（无）`。
 */
export function formatIssues(issues: unknown): string {
  if (!Array.isArray(issues) || issues.length === 0) return "（无）"
  return issues.map((it, i) => `${i + 1}. ${it}`).join("\n")
}

// ============================================================================
// renderScript —— 多步骨架渲染（任务 7.3）
// ============================================================================

/** parallel/pipeline 扇出：默认值与钳制区间 [2,16]。 */
const FANOUT_DEFAULT = 3
const FANOUT_MIN = 2
const FANOUT_MAX = 16

/** branches 分支数钳制区间：[1,16]（至少 1 路，复用并发上限 16）。 */
const BRANCH_MIN = 1
const BRANCH_MAX = 16

/**
 * 钳制分支/维度数量到合法区间 [1,16]（越界裁剪，仅用于渲染防御）。
 * 实际渲染的分支数由用户列表长度决定，此函数用于防御性约束计算。
 */
function clampBranchCount(n: number): number {
  if (!Number.isFinite(n)) return BRANCH_MIN
  return Math.min(BRANCH_MAX, Math.max(BRANCH_MIN, Math.floor(n)))
}

/** 合法 JS 标识符（用于过滤自定义 args 名）。 */
const JS_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** subflow 缺省 subflowName 时的安全占位（生成可运行但需用户修正的引用）。 */
const SUBFLOW_FALLBACK = "default-prd"

/** 各配置资源种类在生成 prompt 中的引导语。 */
/** 知名资源类别的默认引导语（向后兼容）。 */
const CONFIG_PROMPT_LABEL: Record<string, string> = {
  template: "请参考以下模板（用 read 工具读取其内容）：",
  rules: "请遵循以下工程规约（用 read 工具读取其内容）：",
  review: "请对照以下审查标准（用 read 工具读取其内容）：",
}

/**
 * 取某资源类别的引导语：优先用 declaredLabels（自定义类别引导语），其次知名三类默认引导语，
 * 最后为任意自定义类别生成一条通用默认引导语（**不回退写死三类**，R10.4）。
 */
function labelForCategory(category: string, declaredLabels: Record<string, string>): string {
  const declared = declaredLabels[category]
  if (typeof declared === "string" && declared.length > 0) return declared
  if (category in CONFIG_PROMPT_LABEL) return CONFIG_PROMPT_LABEL[category]
  return `请参考以下「${category}」资源（用 read 工具读取其内容）：`
}

/**
 * 生成安全的 JS 字符串字面量：用 `JSON.stringify` 转义引号/反斜杠/换行/Unicode。
 * 产物既是合法 JSON 也是合法 JS 双引号字符串字面量。
 */
function q(value: string): string {
  return JSON.stringify(String(value ?? ""))
}

/** 使任意文本可安全嵌入块注释（避免提前闭合注释）。 */
function commentSafe(value: string): string {
  return String(value ?? "").replace(/\*\//g, "* /")
}

/** 钳制 fanout 到 [2,16]；非有限数回退默认 3。 */
function clampFanout(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return FANOUT_DEFAULT
  return Math.min(FANOUT_MAX, Math.max(FANOUT_MIN, Math.floor(n)))
}

/**
 * 把若干「运行时求值为字符串」的表达式源拼成一个 prompt 表达式源。
 * - 0 个有效片段 → 空串字面量 `""`；
 * - 1 个 → 直接返回该片段；
 * - 多个 → `[a, b, c].filter(Boolean).join("\n\n")`（自动剔除空片段）。
 */
function joinPartsExpr(parts: (string | null | undefined)[]): string {
  const real = parts.filter((p): p is string => typeof p === "string" && p.length > 0)
  if (real.length === 0) return `""`
  if (real.length === 1) return real[0]
  return `[${real.join(", ")}].filter(Boolean).join(${q("\n\n")})`
}

/**
 * 本步要参考的资源类别 → 运行时表达式源数组（按阶段访问，Phase 4）。
 *
 * 每个表达式按 `ctx.config.resourcesByPhase[<phase>][<类别>]` 取绝对路径数组：
 * - 运行时为空数组（未配置/非法）→ 求值为 `""`（被 joinPartsExpr 的 filter(Boolean) 剔除，
 *   **无 header 或结构元素**）；
 * - 非空 → 引导语 + 绝对路径换行拼接。
 *
 * 引导语取 declaredLabels[<类别>]（自定义类别）或类别默认引导语（不回退写死三类）。
 * 使用 ?. 与 ?? [] 保证运行时阶段/类别缺失也不抛错。
 *
 * @param step 步骤定义（包含 useConfig）
 * @param phase 步骤归属的阶段名称
 * @param declaredLabels 自定义类别引导语字典
 * @returns 资源访问表达式源数组
 */
function configPartExprs(step: ScaffoldStep, phase: string, declaredLabels: Record<string, string>): string[] {
  if (!step.useConfig || step.useConfig.length === 0) return []
  const seen = new Set<string>()
  const exprs: string[] = []
  for (const category of step.useConfig) {
    if (typeof category !== "string" || category.length === 0 || seen.has(category)) continue
    seen.add(category)
    const label = labelForCategory(category, declaredLabels)
    // Phase 4: 按阶段访问资源 resourcesByPhase[phase][category]
    const ref = `(ctx.config.resourcesByPhase?.[${q(phase)}]?.[${q(category)}] ?? [])`
    exprs.push(`(${ref}.length ? ${q(label + "\n")} + ${ref}.join(${q("\n")}) : "")`)
  }
  return exprs
}

/**
 * 上一步结果接力表达式源（usePrev）。首步（index===0）或 usePrev 关闭时返回 null —— 不引用任何
 * 未定义变量（R8.6：首步跳过接力）。
 */
function prevPartExpr(index: number, usePrev: boolean): string | null {
  if (!usePrev || index === 0) return null
  return `${q("上游上下文（上一步结果）：\n")} + str(step${index})`
}

/** 具名上游引用解析结果（路径 A）。 */
interface UpstreamRef {
  varName: string
  label: string
}

/**
 * 解析 `step.useSteps`（具名多上游引用，路径 A）。
 * - 无 useSteps（缺省/空）→ 返回 `null`：调用方回退 usePrev 单步接力，**渲染产物逐字节不变**。
 * - 有 useSteps → 解析为 `{varName,label}[]`，仅保留「**更早的、已声明 id 的**」步，去重保序；
 *   忽略未知 id / 自引用 / 前向引用（渲染期防御，Studio 侧另有校验）。可能为空数组（全部非法）。
 */
function resolveUpstreamRefs(
  step: ScaffoldStep,
  index: number,
  idToVar: Map<string, { varName: string; label: string; index: number }>,
): UpstreamRef[] | null {
  if (!Array.isArray(step.useSteps) || step.useSteps.length === 0) return null
  const seen = new Set<string>()
  const refs: UpstreamRef[] = []
  for (const ref of step.useSteps) {
    if (typeof ref !== "string" || ref.length === 0 || seen.has(ref)) continue
    const target = idToVar.get(ref)
    if (!target || target.index >= index) continue
    seen.add(ref)
    refs.push({ varName: target.varName, label: target.label })
  }
  return refs
}

/** 把多上游引用拼成「命名 section 合并」表达式源：`["=== L ===\n" + str(v), ...].join("\n\n")`。 */
function composeSectionsExpr(refs: UpstreamRef[]): string {
  const sections = refs.map((r) => `${q("=== " + r.label + " ===\n")} + str(${r.varName})`)
  return `[${sections.join(", ")}].join(${q("\n\n")})`
}

/** 多上游具名接力表达式源（prompt 注入用，带「上游上下文：」前缀）；空引用 → null（不接力）。 */
function multiUpstreamPartExpr(refs: UpstreamRef[]): string | null {
  if (refs.length === 0) return null
  return `${q("上游上下文：\n")} + ${composeSectionsExpr(refs)}`
}

/** 解析步骤的有效归属阶段：须为已声明阶段，否则回退首个阶段。 */
function effectivePhase(step: ScaffoldStep, phases: string[]): string {
  return phases.includes(step.phase) ? step.phase : phases[0]
}

/**
 * 渲染单维门控步（现有 `runStopGate` 渲染逻辑，行为与产物逐字节不变）。
 *
 * 由 `renderStep` 的 `case "gate"` 在 `dimensions` 为空/缺省时调用，保证「空 dimensions
 * 渲染等价单维」（R3.3/R11.1）由同一函数路径机械保证，而非重复维护两份单维逻辑。
 *
 * @param step 门控步定义。
 * @param index 0-based 步骤序号。
 * @param phase 该步有效归属阶段。
 * @param usePrev 是否接力上一步结果。
 * @param varName 结果变量名（step{index+1}）。
 * @param label 步骤显示标签。
 * @param cfgParts 该步 useConfig 对应的资源引导表达式源数组。
 *
 * Requirements: 3.3, 11.1
 */
function renderSingleGate(
  step: ScaffoldStep,
  phase: string,
  varName: string,
  label: string,
  cfgParts: string[],
  artifactExpr: string,
): string[] {
  const lines: string[] = []
  const gateBody = joinPartsExpr([
    q(step.intent),
    ...cfgParts,
    `${q("请审查以下产物。先逐条列出存在的问题（无问题则说明已通过），最后在末行输出判定：`判定: 通过` 或 `判定: 不通过`。\n\n## 待审查产物\n")} + str(artifact)`,
  ])
  const fixBody = joinPartsExpr([
    `${q("只针对以下审查问题修正（不从头重写），返回修正后的完整产物：\n")} + formatIssues(issues)`,
    `${q("## 当前产物\n")} + str(artifact)`,
  ])
  lines.push(`  const ${varName} = await runStopGate(ctx, {`)
  lines.push(`    phaseTitle: ${q(phase)},`)
  lines.push(`    maxRounds: ctx.config.maxReviewRoundsByPhase?.[${q(phase)}] ?? ctx.config.maxReviewRounds ?? 3,`)
  lines.push(`    artifact: ${artifactExpr},`)
  lines.push(`    label: ${q(label)},`)
  if (step.agentType && step.agentType.length > 0) {
    lines.push(`    agentType: ${q(step.agentType)},`)
  }
  lines.push(`    gatePrompt: (artifact) => ${gateBody},`)
  lines.push(`    fixPrompt: (artifact, issues) => ${fixBody},`)
  lines.push(`  })`)
  return lines
}

/**
 * 渲染多维门控步（`dimensions` 非空时调用），生成 `await runMultiGate(ctx, {...})`。
 *
 * 每维度对象渲染 `name`、由维度 `intent` + 维度 `useConfig` 资源引导 + 待审产物拼接的
 * 审查 `prompt: (artifact) => ...`，并在维度设置 `agentType` 时条件渲染该字段。
 * `artifact` 在「usePrev 启用且非首步」为上一步结果变量 `step{index}`、否则为 `feature`；
 * `maxRounds` 由运行期 `ctx.config.maxReviewRounds` 驱动（钳制在 ConfigLoader 解析侧完成）。
 *
 * @param step 门控步定义。
 * @param index 0-based 步骤序号。
 * @param phase 该步有效归属阶段。
 * @param usePrev 是否接力上一步结果。
 * @param varName 结果变量名（step{index+1}）。
 * @param dimensions 非空审查维度列表。
 * @param declaredLabels 已声明资源类别的引导语字典（自定义类别引导语来源）。
 *
 * Requirements: 4.1, 4.2, 4.4, 4.5
 */
function renderMultiGate(
  step: ScaffoldStep,
  phase: string,
  varName: string,
  dimensions: NonNullable<ScaffoldStep["dimensions"]>,
  declaredLabels: Record<string, string>,
  artifactExpr: string,
): string[] {
  const lines: string[] = []
  lines.push(`  const ${varName} = await runMultiGate(ctx, {`)
  lines.push(`    phaseTitle: ${q(phase)},`)
  lines.push(`    maxRounds: ctx.config.maxReviewRoundsByPhase?.[${q(phase)}] ?? ctx.config.maxReviewRounds ?? 3,`)
  lines.push(`    artifact: ${artifactExpr},`)
  lines.push(`    dimensions: [`)
  for (const d of dimensions) {
    // M3（批次4）：维度有 useConfig → 配置感知 skip（所有类别都空→直接判过；任一非空→审查）
    let promptBody: string
    if (d.useConfig && d.useConfig.length > 0) {
      // 有 useConfig：生成三元
      // Phase 4: 按阶段检查资源是否存在
      const lengthChecks = d.useConfig
        .map((c) => `(ctx.config.resourcesByPhase?.[${q(phase)}]?.[${q(c)}] ?? []).length`)
        .join(" || ")
      
      // 审查分支：intent + 配置引导 + 判定契约
      // Phase 4: 按阶段访问资源
      const dCfg = configPartExprs({ ...step, useConfig: d.useConfig }, phase, declaredLabels)
      const reviewExpr = joinPartsExpr([
        q(d.intent),
        ...dCfg,
        `${q("请审查以下产物。先逐条列出存在的问题（无问题则说明已通过），最后在末行输出判定：`判定: 通过` 或 `判定: 不通过`。\n\n## 待审查产物\n")} + str(artifact)`,
      ])
      
      // skip 分支：无对照基准直接判过（含识别字样）
      const skipText = `本阶段未配置「${d.useConfig.join("/")}」：本维度无对照基准、无需审查。请直接在末行输出判定：\`判定: 通过\`，不要列出任何问题，也不要调用任何工具。`
      const skipExpr = q(skipText)
      
      promptBody = `((${lengthChecks}) ? (${reviewExpr}) : ${skipExpr})`
    } else {
      // 无 useConfig：恒审（现有行为，逐字节不变）
      // Phase 4: 按阶段访问资源
      const dCfg = configPartExprs({ ...step, useConfig: d.useConfig }, phase, declaredLabels)
      promptBody = joinPartsExpr([
        q(d.intent),
        ...dCfg,
        `${q("请审查以下产物。先逐条列出存在的问题（无问题则说明已通过），最后在末行输出判定：`判定: 通过` 或 `判定: 不通过`。\n\n## 待审查产物\n")} + str(artifact)`,
      ])
    }
    const dAt = d.agentType && d.agentType.length > 0 ? `agentType: ${q(d.agentType)}, ` : ""
    lines.push(`      { name: ${q(d.name)}, ${dAt}prompt: (artifact) => ${promptBody} },`)
  }
  lines.push(`    ],`)
  const fixBody = joinPartsExpr([
    `${q("只针对以下分维度审查问题修正（不从头重写），返回修正后的完整产物：\n")} + formatIssues(issues)`,
    `${q("## 当前产物\n")} + str(artifact)`,
  ])
  lines.push(`    fixPrompt: (artifact, issues) => ${fixBody},`)
  lines.push(`  })`)
  return lines
}

/** adversarial 反驳者数默认与区间（复用 FANOUT 钳制 [2,16]）。 */
const ADVERSARIAL_FANOUT_DEFAULT = 3
/** finder-loop 收敛轮次默认与上限轮次默认。 */
const CONVERGENCE_ROUNDS_DEFAULT = 2
const FINDER_MAX_ROUNDS_DEFAULT = 10
/** judge-panel 默认起草角度（至少两个互异角度，R6.3）。 */
const DEFAULT_PERSPECTIVES = ["方案完备优先", "风险稳健优先", "用户体验优先"]

/** 计算 adversarial 反驳阈值：显式 threshold 优先，否则 ceil(fanout/2)（R2.4）。 */
function adversarialThreshold(step: ScaffoldStep, fanout: number): number {
  const t = step.threshold
  if (typeof t === "number" && Number.isFinite(t) && t >= 1) return Math.floor(t)
  return Math.ceil(fanout / 2)
}

/** 钳制为 >=1 的正整数，非法回退默认值。 */
function clampPositive(n: number | undefined, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return fallback
  return Math.floor(n)
}

/**
 * 渲染单个步骤为代码行（每行含其在 execute 体内的缩进）。
 *
 * @param step 步骤定义。
 * @param index 0-based 步骤序号（决定结果变量名 step{index+1} 与是否为首步）。
 * @param phases 已声明阶段集合（用于阶段回退）。
 * @param declaredLabels 已声明资源类别的引导语字典（自定义类别引导语来源，R10.4）。
 */
function renderStep(step: ScaffoldStep, index: number, phases: string[], declaredLabels: Record<string, string>, idToVar: Map<string, { varName: string; label: string; index: number }>): string[] {
  const lines: string[] = []
  const phase = effectivePhase(step, phases)
  const usePrev = step.usePrev !== false
  const varName = `step${index + 1}`
  const label = step.label && step.label.length > 0 ? step.label : `步骤 ${index + 1}`
  // Phase 4: 传入 phase 参数以按阶段访问资源
  const cfgParts = configPartExprs(step, phase, declaredLabels)
  // 接力来源：useSteps 具名多上游优先（路径 A），缺省回退 usePrev 单步接力（逐字节兼容）。
  const refs = resolveUpstreamRefs(step, index, idToVar)
  const prevExpr = refs === null ? prevPartExpr(index, usePrev) : multiUpstreamPartExpr(refs)
  // agentType opts 片段（R14.4）：设置则注入 `, agentType: "xxx"`，未设置为空串（默认 Agent，R16.6）。
  const at = agentTypeField(step)

  switch (step.kind) {
    case "parallel": {
      const n = clampFanout(step.fanout)
      const baseExpr = joinPartsExpr([q(step.intent), ...cfgParts, prevExpr])
      lines.push(`  const base_${varName} = ${baseExpr}`)
      lines.push(`  const ${varName} = await ctx.parallel([`)
      for (let k = 1; k <= n; k++) {
        const branchTag = q("\n\n并行分支 " + k + "/" + n)
        lines.push(
          `    () => ctx.agent(base_${varName} + ${branchTag}, { label: ${q(label + " #" + k)}, phase: ${q(phase)}${at}, required: true }),`,
        )
      }
      lines.push(`  ])`)
      return lines
    }
    case "pipeline": {
      const n = clampFanout(step.fanout)
      const baseExpr = joinPartsExpr([q(step.intent), ...cfgParts, prevExpr])
      lines.push(`  const items_${varName} = Array.from({ length: ${n} }, (_, i) => ${q("条目 ")} + (i + 1))`)
      lines.push(`  const base_${varName} = ${baseExpr}`)
      lines.push(`  const ${varName} = await ctx.pipeline(`)
      lines.push(`    items_${varName},`)
      lines.push(
        `    async (prev, item, index) => ctx.agent(base_${varName} + ${q("\n\n当前条目：")} + str(item), { label: ${q(label + " #")} + (index + 1), phase: ${q(phase)}${at}, required: true }),`,
      )
      lines.push(`  )`)
      return lines
    }
    case "gate": {
      const dimensions = Array.isArray(step.dimensions) ? step.dimensions : []
      // 门控 artifact 来源：useSteps 具名多上游 → 组合 section；缺省 → usePrev 单步（逐字节兼容）。
      let artifactExpr: string
      if (refs === null) {
        artifactExpr = usePrev && index > 0 ? `step${index}` : "feature"
      } else if (refs.length > 0) {
        artifactExpr = `__artifact_${varName}`
        lines.push(`  const ${artifactExpr} = ${composeSectionsExpr(refs)}`)
      } else {
        artifactExpr = "feature"
      }
      // dimensions 空/缺省 → 退化为单维 runStopGate（向后兼容，R3.3/R11.1）。
      if (dimensions.length === 0) {
        lines.push(...renderSingleGate(step, phase, varName, label, cfgParts, artifactExpr))
        return lines
      }
      // dimensions 非空 → 多维门控 runMultiGate（R4.1/R4.2/R4.4/R4.5）。
      lines.push(...renderMultiGate(step, phase, varName, dimensions, declaredLabels, artifactExpr))
      return lines
    }
    case "branches": {
      const branches = Array.isArray(step.branches) ? step.branches : []
      // 空/缺省 → 合并为安全空串，不抛运行时错误（R2.8）。
      if (branches.length === 0) {
        lines.push(`  const ${varName} = ""`)
        return lines
      }
      // 渲染防御：分支数受 [1,16] 约束（实际工厂数由用户列表决定，clampBranchCount 仅作上界守护）。
      const renderCount = clampBranchCount(branches.length)
      lines.push(`  const parts_${varName} = await ctx.parallel([`)
      for (let b = 0; b < branches.length && b < renderCount; b++) {
        const br = branches[b]
        // 仅首分支接力上游（与 default runRetrieval 同形：上下文一次性合并后接力，R2.2）。
        const brPrev = b === 0 ? prevExpr : null
        // M1: 有 useConfig → configAwarePromptExpr；M2: agentType=explore → explorePromptExpr；无→普通
        let promptExpr: string
        if (br.agentType === "explore") {
          // Phase 4: 按阶段访问资源
          const brCfg = configPartExprs({ ...step, useConfig: br.useConfig }, phase, declaredLabels)
          promptExpr = explorePromptExpr(br.intent, brCfg, brPrev)
        } else if (br.useConfig && br.useConfig.length > 0) {
          // Phase 4: 传入 phase 参数
          promptExpr = configAwarePromptExpr(br.intent, br.useConfig, phase, declaredLabels, brPrev)
        } else {
          promptExpr = joinPartsExpr([q(br.intent), brPrev])
        }
        const brAt = br.agentType && br.agentType.length > 0 ? `, agentType: ${q(br.agentType)}` : ""
        const brLabel = br.label && br.label.length > 0 ? br.label : `分支 ${b + 1}`
        lines.push(
          `    () => ctx.agent(${promptExpr}, { label: ${q(brLabel)}, phase: ${q(phase)}${brAt}, required: true }),`,
        )
      }
      lines.push(`  ])`)
      // 合并为命名 section 字符串（复刻 default runRetrieval 的 section 合并，R2.5）。
      const titles = branches
        .slice(0, renderCount)
        .map((b) => q(b.label && b.label.length > 0 ? b.label : "分支"))
        .join(", ")
      lines.push(`  const ${varName} = [${titles}]`)
      lines.push(`    .map((t, i) => ${q("=== ")} + t + ${q(" ===\n")} + str(parts_${varName}[i]))`)
      lines.push(`    .join(${q("\n\n")})`)
      return lines
    }
    case "adversarial": {
      const fanout = clampFanout(step.fanout ?? ADVERSARIAL_FANOUT_DEFAULT)
      const threshold = adversarialThreshold(step, fanout)
      const artifactExpr = usePrev && index > 0 ? `step${index}` : "feature"
      const refuteBody = joinPartsExpr([
        q(step.intent),
        ...cfgParts,
        `${q("请尝试反驳以下产物：逐条列出你能找到的反驳理由；不确定时默认判为「已反驳」。最后在末行输出判定：`判定: 通过`（无法反驳）或 `判定: 不通过`（已反驳）。\n\n## 待验证产物\n")} + str(artifact)`,
      ])
      lines.push(`  const ${varName} = await runAdversarial(ctx, {`)
      lines.push(`    phaseTitle: ${q(phase)},`)
      lines.push(`    artifact: ${artifactExpr},`)
      lines.push(`    fanout: ${fanout},`)
      lines.push(`    threshold: ${threshold},`)
      if (step.agentType) lines.push(`    agentType: ${q(step.agentType)},`)
      lines.push(`    prompt: (artifact) => ${refuteBody},`)
      lines.push(`  })`)
      return lines
    }
    case "finder-loop": {
      const convergence = clampPositive(step.convergenceRounds, CONVERGENCE_ROUNDS_DEFAULT)
      const maxRounds = clampPositive(step.maxRounds, FINDER_MAX_ROUNDS_DEFAULT)
      const findBody = joinPartsExpr([
        q(step.intent),
        ...cfgParts,
        `${q("\n\n已见（勿重复）：\n")} + (seenList || ${q("（暂无）")}) + ${q("\n\n只返回【新】发现，每行一条；若无新发现，仅输出一行 [无新增]。")}`,
      ])
      lines.push(`  const ${varName} = await runFinderLoop(ctx, {`)
      lines.push(`    phaseTitle: ${q(phase)},`)
      lines.push(`    convergenceRounds: ${convergence},`)
      lines.push(`    maxRounds: ${maxRounds},`)
      if (step.agentType) lines.push(`    agentType: ${q(step.agentType)},`)
      lines.push(`    prompt: (seenList, round) => ${findBody},`)
      lines.push(`  })`)
      return lines
    }
    case "judge-panel": {
      const perspectives = Array.isArray(step.perspectives) && step.perspectives.length > 0
        ? step.perspectives : DEFAULT_PERSPECTIVES
      const synthesis = step.synthesis && step.synthesis.length > 0
        ? step.synthesis : "综合各候选方案的优点，产出单一最优方案，并吸收其它方案中值得保留的亮点。"
      const artifactExpr = usePrev && index > 0 ? `str(step${index})` : "feature"
      const draftBody = joinPartsExpr([
        q(step.intent), ...cfgParts,
        `${q("\n\n请从「")} + perspective + ${q("」角度起草方案。\n\n## 上下文\n")} + ${artifactExpr}`,
      ])
      lines.push(`  const ${varName} = await runJudgePanel(ctx, {`)
      lines.push(`    phaseTitle: ${q(phase)},`)
      lines.push(`    perspectives: [${perspectives.map(q).join(", ")}],`)
      if (step.agentType) lines.push(`    agentType: ${q(step.agentType)},`)
      lines.push(`    draftPrompt: (perspective) => ${draftBody},`)
      lines.push(`    scorePrompt: (draft) => ${q("请为以下方案打分（1-10）并给出简短理由，末行输出 `得分: N`：\n\n")} + str(draft),`)
      lines.push(`    synthesisPrompt: (scoredText) => ${q(synthesis + "\n\n## 候选方案与得分\n")} + scoredText,`)
      lines.push(`  })`)
      return lines
    }
    case "subflow": {
      const subName = step.subflowName && step.subflowName.length > 0 ? step.subflowName : SUBFLOW_FALLBACK
      if (!step.subflowName || step.subflowName.length === 0) {
        lines.push(`  // TODO: 将下方 subflow 名替换为已注册的 workflow 名（占位为 ${SUBFLOW_FALLBACK}）。`)
      }
      const subArgs =
        refs !== null
          ? refs.length > 0
            ? `{ feature, upstreamSummary: ${composeSectionsExpr(refs)} }`
            : `{ feature }`
          : usePrev && index > 0
            ? `{ feature, upstreamSummary: str(step${index}) }`
            : `{ feature }`
      lines.push(`  const ${varName} = await ctx.workflow(${q(subName)}, ${subArgs})`)
      return lines
    }
    case "single":
    default: {
      // M1: 有 useConfig → configAwarePromptExpr（配置感知三元）；无 → 现有逻辑（逐字节不变）
      // M2: agentType=explore → explorePromptExpr 套 READ-ONLY 模板
      let promptExpr: string
      if (step.agentType === "explore") {
        // Phase 4: 按阶段访问资源
        const cfgParts = configPartExprs(step, phase, declaredLabels)
        promptExpr = explorePromptExpr(step.intent, cfgParts, prevExpr)
      } else if (step.useConfig && step.useConfig.length > 0) {
        // Phase 4: 传入 phase 参数
        promptExpr = configAwarePromptExpr(step.intent, step.useConfig, phase, declaredLabels, prevExpr)
      } else {
        promptExpr = joinPartsExpr([q(step.intent), prevExpr])
      }
      lines.push(`  const prompt_${varName} = ${promptExpr}`)
      lines.push(`  const ${varName} = await ctx.agent(prompt_${varName}, { label: ${q(label)}, phase: ${q(phase)}${at}, required: true })`)
      return lines
    }
  }
}

/**
 * agentType opts 字段片段（R14.4）。
 * - 设置了 agentType → `, agentType: "xxx"`；
 * - 未设置 → 空串（生成脚本不含该字段，由框架按默认 Agent 执行，R16.6）。
 */
function agentTypeField(step: ScaffoldStep): string {
  if (typeof step.agentType === "string" && step.agentType.length > 0) {
    return `, agentType: ${q(step.agentType)}`
  }
  return ""
}

/** 内联 `str()` 辅助（始终注入）：把任意 agent() 返回值安全转为字符串。 */
function strHelperLines(): string[] {
  return [
    "/** 将任意 agent() 返回值安全转为字符串（用于拼接到下游 prompt）。 */",
    "function str(value) {",
    `  if (value == null) return ${q("[无结果]")}`,
    `  if (typeof value === "string") return value`,
    "  try {",
    "    return JSON.stringify(value, null, 2)",
    "  } catch {",
    "    return String(value)",
    "  }",
    "}",
  ]
}

/**
 * 内联门控辅助（parseVerdict + formatIssues + runStopGate）；仅当存在 gate 步骤时注入。
 *
 * 门控宽松化（wf-gate-loosening-and-fault-tolerance，金标准 #1）：弃用 `format:json_schema`，
 * 移除 `GATE_SCHEMA`/`normalizeGate`/`stringifyIssue` 注入，改为「自由文本 + 末行判定」约定，
 * 由注入的 `parseVerdict` 解析末行判定行得到布尔判定与 prose issues。`runStopGate` 不再带
 * schema，并区分两条「不可评估」提前返回（不进修正分支、不消耗修正轮次，R8.1/R8.2/R8.3）。
 */
function gateHelperLines(): string[] {
  return [
    "/** 从门控自由文本解析末行判定（中英双语，取末个匹配，「不通过/fail」优先）。 */",
    "function parseVerdict(text) {",
    `  const s = String(text ?? ${q("")})`,
    `  if (s.trim().length === 0) return { passed: false, evaluable: false, issues: [${q("判定不可解析")}] }`,
    "  const lines = s.split(/\\r?\\n/)",
    "  const re = /(?:判定|verdict)\\s*[:：]\\s*(不通过|通过|fail|pass)/i",
    "  let verdictIdx = -1",
    "  for (let i = lines.length - 1; i >= 0; i--) {",
    "    if (re.test(lines[i])) { verdictIdx = i; break }",
    "  }",
    `  if (verdictIdx < 0) return { passed: false, evaluable: false, issues: [${q("判定不可解析")}] }`,
    "  const m = re.exec(lines[verdictIdx])",
    `  const token = (m && m[1] ? m[1] : ${q("")}).toLowerCase()`,
    `  const passed = !(token.indexOf(${q("不通过")}) >= 0 || token === ${q("fail")}) && (token.indexOf(${q("通过")}) >= 0 || token === ${q("pass")})`,
    `  const prose = lines.filter((_, i) => i !== verdictIdx).join(${q("\n")}).trim()`,
    "  return { passed, evaluable: true, issues: passed ? [] : (prose ? [prose] : []) }",
    "}",
    "",
    "/** 把 issues 数组格式化为编号清单文本（供 fixPrompt 使用）。 */",
    "function formatIssues(issues) {",
    `  if (!Array.isArray(issues) || issues.length === 0) return ${q("（无）")}`,
    `  return issues.map((it, i) => (i + 1) + ${q(". ")} + it).join(${q("\n")})`,
    "}",
    "",
    "/** Ralph Loop / stop-gate（DSL 控制流）：门控未过则修正重跑，直至通过或轮次耗尽后降级。 */",
    "async function runStopGate(ctx, { phaseTitle, maxRounds, artifact, gatePrompt, fixPrompt, label, agentType }) {",
    "  let current = artifact",
    "  let round = 0",
    "  let gate = { passed: false, evaluable: true, issues: [] }",
    "  while (round < maxRounds) {",
    "    round += 1",
    `    const raw = await ctx.agent(gatePrompt(current, round), { label: label + ${q(" #")} + round, phase: phaseTitle, ...(agentType ? { agentType } : {}) })`,
    "    if (raw == null) {",
    "      // 基础设施失败（执行器返回 null）：不可评估，不消耗修正轮次，降级返回。",
    `      return { passed: false, evaluable: false, rounds: round, issues: [${q("[不可评估] 门控未返回结果（基础设施失败）")}], artifact: current }`,
    "    }",
    "    gate = parseVerdict(raw)",
    "    if (!gate.evaluable) {",
    "      // 判定不可解析：不可评估，不消耗修正轮次，降级返回。",
    `      return { passed: false, evaluable: false, rounds: round, issues: [${q("[不可评估] 判定不可解析")}], artifact: current }`,
    "    }",
    "    if (gate.passed) return { passed: true, evaluable: true, rounds: round, issues: [], artifact: current }",
    "    // 未通过即修正（含最后一轮）：末轮终修产物不再复审，直接降级落盘（问题 9）。",
    `    const fixed = await ctx.agent(fixPrompt(current, gate.issues, round), { label: ${q("修正 #")} + round, phase: phaseTitle, ...(agentType ? { agentType } : {}) })`,
    "    if (fixed != null) current = fixed",
    "  }",
    "  return { passed: false, evaluable: true, rounds: round, issues: gate.issues, artifact: current }",
    "}",
  ]
}

/**
 * 是否存在多维门控步（控制 runMultiGate helper 注入）。
 *
 * 多维门控步 = `kind === "gate"` 且 `dimensions` 为非空数组。`dimensions` 为空/缺省
 * 的 gate 步退化为单维 `runStopGate`，不计入（保向后兼容，R3.3/R11.1）。
 *
 * @param steps 步骤列表。
 * @returns 存在至少一个多维门控步则为真。
 *
 * Requirements: 4.3
 */
function hasMultiGate(steps: ScaffoldStep[]): boolean {
  return steps.some((s) => s.kind === "gate" && Array.isArray(s.dimensions) && s.dimensions.length > 0)
}

/**
 * 内联多维门控辅助（仅 `runMultiGate` 函数定义）；仅当存在多维门控步时追加注入。
 *
 * **依赖**：复用 `gateHelperLines()` 已注入的 `parseVerdict`（及 `formatIssues`）。
 * 多维 gate 必然满足 `hasGate`（kind==="gate"），故 `gateHelperLines()` 必已先于本函数注入
 * `parseVerdict`，本函数只追加 `runMultiGate` 定义，不重复注入（R4.3）。
 *
 * 门控宽松化（wf-gate-loosening-and-fault-tolerance，金标准 #2）：`runMultiGate` 去 `GATE_SCHEMA`、
 * 并发组改无 schema（R1.1/R1.4）、改用 `parseVerdict` 解析末行判定（R1.x）；新增「不可评估」分支——
 * 维度返回 null（执行器降级，R8.1）或判定不可解析（R8.2）时进 `unevaluable`，不进 `failed`，
 * 故不触发针对它的修正、不消耗修正轮次；输出 issues 以醒目 `[不可评估]` 前缀标注（R8.3）。
 *
 * runMultiGate 运行时行为：
 * - pending 初始为全部维度；
 * - 每轮经 `ctx.parallel` 对 pending 各维度并发审查（无 schema，确定的 agentIndex 序）；
 * - 各维度结果：null → 不可评估降级；`parseVerdict` 不可解析 → 不可评估降级；可评估且未通过 → 进 failed；
 * - failed 为空且无不可评估维度 → 整体 `passed/evaluable` 为 true；存在不可评估维度 → `passed/evaluable` 为 false（不误判通过）；
 * - 有 fail（含最后一轮）→ `fixPrompt` 针对性修正（仅 failed 维度），产物接力下一轮（增量重审）；末轮终修产物不再复审；
 * - 轮次耗尽降级保留当前产物（末轮终修后版本）+ 返回未解决问题与不可评估标注。
 *
 * Requirements: 1.1, 1.3, 1.4, 3.2, 4.3, 8.1, 8.2, 8.3
 */
function multiGateHelperLines(): string[] {
  return [
    "/** 多维并发审查门控：并发审查 + 任一不过即不过 + 针对性修正 + 增量重审 + 不可评估降级。 */",
    "async function runMultiGate(ctx, { phaseTitle, maxRounds, artifact, dimensions, fixPrompt }) {",
    "  let current = artifact",
    "  let round = 0",
    "  let pending = Array.isArray(dimensions) ? dimensions.slice() : []",
    "  let unresolved = []",
    "  let unevaluable = []",
    "  while (round < maxRounds) {",
    "    round += 1",
    "    // 对当前 pending 各维度并发审查（无 schema，确定的 agentIndex 序）。",
    "    const results = await ctx.parallel(",
    "      pending.map((d) => {",
    `        const opts = { label: phaseTitle + ${q(" · ")} + d.name + ${q("(第")} + round + ${q("轮)")}, phase: phaseTitle }`,
    "        if (d.agentType) opts.agentType = d.agentType",
    "        return () => ctx.agent(d.prompt(current), opts)",
    "      }),",
    "    )",
    "    // 聚合：null/不可解析维度标「不可评估」（不进 failed、不消耗修正轮次）；可评估且未通过进 failed。",
    "    const failed = []",
    "    unresolved = []",
    "    unevaluable = []",
    "    for (let i = 0; i < pending.length; i++) {",
    "      const r = results[i]",
    "      if (r == null) {",
    "        // 基础设施失败：标「不可评估」，不计入 failed。",
    `        unevaluable.push(${q("[不可评估] [")} + pending[i].name + ${q("] 门控未返回结果（基础设施失败）")})`,
    "        continue",
    "      }",
    "      const g = parseVerdict(r)",
    "      if (!g.evaluable) {",
    `        unevaluable.push(${q("[不可评估] [")} + pending[i].name + ${q("] 判定不可解析")})`,
    "        continue",
    "      }",
    "      if (!g.passed) {",
    "        failed.push(pending[i])",
    `        for (const issue of g.issues) unresolved.push(${q("[")} + pending[i].name + ${q("] ")} + issue)`,
    "      }",
    "    }",
    "    // 仅「可评估且未通过」的维度参与修正/重审；不可评估维度不消耗修正轮次。",
    "    if (failed.length === 0) {",
    "      return { passed: unevaluable.length === 0, evaluable: unevaluable.length === 0, rounds: round, issues: unevaluable, artifact: current }",
    "    }",
    "    // 有 fail 即针对性修正（含最后一轮）：末轮终修产物不再复审，直接降级落盘（问题 9）。",
    `    const fixed = await ctx.agent(fixPrompt(current, unresolved, round), { label: phaseTitle + ${q(" · 修正(第")} + round + ${q("轮)")}, phase: phaseTitle })`,
    "    if (fixed != null) current = fixed",
    "    pending = failed // 下一轮仅重审上轮 fail（增量重审）。",
    "  }",
    "  // 轮次耗尽降级：保留当前产物 + 返回未解决问题与不可评估标注。",
    "  return { passed: false, evaluable: unevaluable.length === 0, rounds: round, issues: unresolved.concat(unevaluable), artifact: current }",
    "}",
  ]
}

/**
 * 渲染 workflow 脚本文本（纯函数，无副作用）。
 *
 * 关键保证：
 * - **meta 为纯字面量**：`name`/`description`/`phases` 全部内联为字符串/对象字面量，
 *   不含任何变量引用或函数调用，可被 ScriptLoader 的 `extractMeta` 静态 AST 提取（不抛 META_INVALID，R8.1）。
 * - 按 `answers.steps` 顺序生成 `single`/`parallel`/`pipeline`/`gate`/`subflow` 对应代码（R8.4）。
 * - `usePrev`（默认真）把上一步返回值经内联 `str()` 拼入本步 prompt；首步自动跳过接力且不引用未定义变量（R8.5/R8.6）。
 * - `consumesConfig` 为真时生成 `ctx.config.template/rules/review/outputPath` 的消费与产出落盘骨架（R8.7）；
 *   各步的 `useConfig` 据此把对应 `ctx.config.<kind>` 绝对路径拼进本步 prompt。
 * - 始终包含一处 `agentType` 用法注释（不改变默认执行行为，R7.1）。
 * - `fanout` 钳制 2–16（默认 3）；gate/multiGate 的 `maxRounds` 由运行期 `ctx.config.maxReviewRounds` 驱动（钳制在 ConfigLoader 解析侧）。
 *
 * @param answers 引导式交互收集到的答案（应已通过 validateName 与基本结构校验）。
 * @returns 完整、语法正确、可被求值的 `.mjs` 脚本文本。
 *
 * Requirements: 10.4, 11.1, 11.2, 11.3, 11.4, 14.4, 16.1, 16.2, 16.3, 16.5, 16.6
 */
export function renderScript(answers: ScaffoldAnswers): string {
  const name = (answers.name ?? "").trim() || "custom-workflow"
  const description =
    (answers.description ?? "").trim() || "由 Workflow Studio 引导式生成的自定义 workflow"
  const phases = Array.isArray(answers.phases) && answers.phases.length > 0 ? answers.phases : ["Main"]
  const steps = Array.isArray(answers.steps) ? answers.steps : []
  const declaredLabels =
    answers.resourceLabels && typeof answers.resourceLabels === "object" ? answers.resourceLabels : {}
  const declaredCategories =
    answers.resources && typeof answers.resources === "object" ? Object.keys(answers.resources) : []
  const hasOutputPath = typeof answers.outputPath === "string" && answers.outputPath.trim().length > 0
  // 是否生成「配置消费 / 产出落盘」骨架：声明了任意资源类别或配置了落盘路径（取代旧 consumesConfig，R12.1）。
  // 既有不使用配置的 wf（resources 空且无 outputPath）→ 不生成骨架，与旧 consumesConfig=false 等价（R16.1）。
  const consumesConfig = declaredCategories.length > 0 || hasOutputPath
  const hasGate = steps.some((s) => s.kind === "gate")
  const needsMultiGate = hasMultiGate(steps)
  const hasAdversarial = steps.some((s) => s.kind === "adversarial")
  const hasFinderLoop  = steps.some((s) => s.kind === "finder-loop")
  const hasJudgePanel  = steps.some((s) => s.kind === "judge-panel")
  // adversarial 依赖 parseVerdict：若已因 hasGate 注入则复用，否则单独注入 parseVerdict
  const needsVerdict = hasGate || hasAdversarial
  const customArgs = (Array.isArray(answers.args) ? answers.args : [])
    .map((a) => (a ?? "").trim())
    .filter((a) => JS_IDENTIFIER_RE.test(a) && a !== "feature")

  const out: string[] = []

  // ---- 文件头注释 ----
  out.push("/**")
  out.push(` * ${commentSafe(name)} —— 由 Workflow Studio 引导式生成的自定义 workflow。`)
  out.push(" *")
  out.push(` * ${commentSafe(description)}`)
  out.push(" *")
  out.push(` * 运行：/workflows-run → 选择 "${commentSafe(name)}" → 输入 feature。`)
  out.push(` * 配置：可在 ~/.opencode-workflows/${commentSafe(name)}.config.json 提供 resources / resourceLabels / output_path。`)
  out.push(" */")
  out.push("")

  // ---- meta（纯字面量，可被 extractMeta 静态提取）----
  out.push("export const meta = {")
  out.push(`  name: ${q(name)},`)
  out.push(`  description: ${q(description)},`)
  out.push(`  phases: [${phases.map((p) => `{ title: ${q(p)} }`).join(", ")}],`)
  out.push("}")
  out.push("")

  // ---- 内联辅助 ----
  out.push(...strHelperLines())
  out.push("")
  if (needsVerdict && !hasGate) out.push(...verdictOnlyHelperLines())
  if (hasGate) {
    out.push(...gateHelperLines())
    out.push("")
  }
  if (needsMultiGate) {
    // 复用 gateHelperLines() 已注入的 parseVerdict，只追加 runMultiGate 定义（R4.3）。
    out.push(...multiGateHelperLines())
    out.push("")
  }
  if (hasAdversarial) { out.push(...runAdversarialHelperLines()); out.push("") }
  if (hasFinderLoop)  { out.push(...runFinderLoopHelperLines()); out.push("") }
  if (hasJudgePanel)  { out.push(...runJudgePanelHelperLines()); out.push("") }

  // ---- execute 主体 ----
  out.push("export default async function execute(ctx) {")
  out.push("  const args = ctx.args || {}")
  out.push(`  const feature = args.feature || ${q("当前需求")}`)
  if (customArgs.length > 0) {
    out.push("  // 自定义参数（运行时经 ctx.args 注入；未传时为 undefined）：")
    for (const a of customArgs) out.push(`  const ${a} = args.${a}`)
  }
  out.push("")

  // agentType 用法注释（始终存在；不改变未显式设置时的默认执行行为，R16.6）。
  out.push("  // 可选：为子 Agent 指定自定义 Agent 类型（agentType，子 Agent 调用的可选选项字段）。")
  out.push("  // 未设置时由框架按默认 Agent 类型执行；如需指定，在步骤里选择执行 Agent（仅 subagent/all）。")
  out.push("")

  if (consumesConfig) {
    out.push("  // ── 消费配置（ctx.config.resourcesByPhase）：各阶段各类别为绝对路径数组，由 read 工具按需读取 ──")
    if (declaredCategories.length > 0) {
      const catList = declaredCategories.map((c) => q(c)).join(", ")
      out.push(`  const __cats = [${catList}]`)
      out.push(
        `  const __cnt = (c) => Object.values(ctx.config.resourcesByPhase || {}).reduce((n, byCat) => n + ((byCat && byCat[c]) || []).length, 0)`,
      )
      out.push(
        `  ctx.log(${q("[" + name + "] 配置 → ")} + __cats.map((c) => c + ${q(":")} + __cnt(c)).join(${q(" / ")}))`,
      )
    } else {
      out.push(
        `  ctx.log(${q("[" + name + "] 配置 → 仅落盘（无资源类别）")})`,
      )
    }
    out.push("")
  }

  // 逐步生成（含按需的 phase 切换）。
  // 具名上游引用表（路径 A）：声明了 id 的步 → {结果变量名, 标签, 序号}，供 useSteps 解析。
  const idToVar = new Map<string, { varName: string; label: string; index: number }>()
  steps.forEach((s, i) => {
    if (typeof s.id === "string" && s.id.length > 0) {
      idToVar.set(s.id, {
        varName: `step${i + 1}`,
        label: s.label && s.label.length > 0 ? s.label : `步骤 ${i + 1}`,
        index: i,
      })
    }
  })
  let lastPhase: string | null = null
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const phase = effectivePhase(step, phases)
    if (phase !== lastPhase) {
      out.push(`  ctx.phase(${q(phase)})`)
      lastPhase = phase
    }
    out.push(...renderStep(step, i, phases, declaredLabels, idToVar))
    out.push("")
  }

  // ---- 产出落盘骨架（配置了 outputPath 时）----
  if (consumesConfig) {
    const finalArtifactExpr = steps.length > 0 ? `step${steps.length}` : "feature"
    // 落盘归属阶段：取最后一步的有效阶段（无步骤时回退首个阶段）。per-phase 优先，回退全局 outputPath。
    const outPhase = steps.length > 0 ? effectivePhase(steps[steps.length - 1], phases) : phases[0]
    // 问题 8 修复：产出由框架 ctx.writeFile 直写（不再让 LLM 用 write 工具逐字复写大文档）——
    // 零 token、瞬时、可靠，消除 LLM 复写卡死/截断/改写。脚本无需 import，保持自包含。
    out.push("  // ── 产出落盘（消费 ctx.config.outputPathByPhase[阶段]，回退全局 outputPath）：非空则由框架 ctx.writeFile 直写，否则跳过 ──")
    out.push(`  const __outPath = ctx.config.outputPathByPhase?.[${q(outPhase)}] ?? ctx.config.outputPath ?? null`)
    out.push("  if (__outPath) {")
    out.push("    try {")
    out.push(`      await ctx.writeFile(__outPath, str(${finalArtifactExpr}))`)
    out.push(`      ctx.log(${q("[" + name + "] 落盘成功：")} + __outPath)`)
    out.push("    } catch (e) {")
    out.push(`      ctx.log(${q("[" + name + "] ⚠ 落盘失败：")} + (e && e.message ? e.message : String(e)))`)
    out.push("    }")
    out.push("  } else {")
    out.push(`    ctx.log(${q("[" + name + "] 未配置 outputPath，跳过落盘")})`)
    out.push("  }")
    out.push("")
  }

  // ---- 返回结构化产物 ----
  if (steps.length > 0) {
    const stepVars = steps.map((_, i) => `step${i + 1}`).join(", ")
    out.push("  return {")
    out.push(`    workflow: ${q(name)},`)
    out.push("    feature,")
    out.push(`    steps: { ${stepVars} },`)
    out.push("  }")
  } else {
    out.push(`  return { workflow: ${q(name)}, feature }`)
  }

  out.push("}")
  out.push("")

  return out.join("\n")
}
