/**
 * OpenCode Workflows —— DraftStore（向导结构草稿 sidecar 序列化/解析，新增）。
 *
 * 背景（方案 C「编辑已有自定义 workflow 结构」）：Studio「新建」向导一旦生成
 * `<name>.mjs` + `<name>.config.json` 后，写进 `.mjs` 的**结构性**内容（phases/steps/
 * 编排模式/branches/dimensions/args）此前没有任何向导回填入口——只能手改脚本。为支持
 * 「再次进向导改结构」，创建时**额外**落一份结构草稿 sidecar `<name>.draft.json`，
 * 编辑时读回作为向导 `answers` 的回填源。
 *
 * 职责切分（避免双写不一致）：
 * - **结构真相** = `<name>.draft.json`：仅存 name/description/phases/steps/args。
 * - **配置真相** = `<name>.config.json`：存 resources/resourceLabels/output_path。
 *   故 draft **不重复**存资源/落盘字段——编辑时资源仍由 config.json 回填（用户可能单独经
 *   Studio「改配置」改过配置），二者各自独立、互不覆盖。
 *
 * 本模块为**纯逻辑**（无副作用、不碰 FS）：序列化（{@link renderDraftJson}）与
 * 防御式解析（{@link parseDraftJson}，任意字段缺失/非法 → 跳过该字段或整体降级 null，绝不抛）。
 * 落盘端口（原子写）由 `tui.tsx` 注入，与 `writeUserConfigToGlobalDir` 同语义。
 *
 * @see .kiro/specs（方案 C 讨论纪要）
 */

import type { BranchSpec, DimensionSpec, DraftStructure, ScaffoldStep, StepKind } from "../types"

/** 草稿 sidecar 当前 schema 版本（向后兼容演进用）。 */
export const DRAFT_SCHEMA_VERSION = 1

/** 重导出 {@link DraftStructure}（结构草稿承载的字段子集，定义在 types.ts 以避免循环依赖）。 */
export type { DraftStructure } from "../types"

/** 单 workflow 结构草稿文件名：`<name>.draft.json`。 */
export function draftFileNameOf(workflowName: string): string {
  return `${workflowName}.draft.json`
}

/** 合法 StepKind 白名单（解析时据此校验，未知 kind 退化为 single）。 */
const STEP_KINDS: ReadonlySet<StepKind> = new Set<StepKind>([
  "single",
  "parallel",
  "pipeline",
  "gate",
  "subflow",
  "branches",
])

/**
 * 从一个 {@link ScaffoldAnswers}（或其结构子集）投影出仅含结构字段的 {@link DraftStructure}。
 * 纯函数：不修改入参、深拷贝数组/对象，避免 sidecar 与向导状态共享引用。
 */
export function toDraftStructure(answers: DraftStructure): DraftStructure {
  return {
    name: answers.name,
    description: answers.description,
    phases: Array.isArray(answers.phases) ? answers.phases.slice() : [],
    steps: Array.isArray(answers.steps) ? answers.steps.map(cloneStep) : [],
    args: Array.isArray(answers.args) ? answers.args.slice() : [],
  }
}

/**
 * 把向导结构草稿序列化为 `<name>.draft.json` 文本（纯函数）。
 *
 * 产物为带 `version` 的合法 JSON（稳定缩进），仅含结构字段；资源/落盘有意省略
 * （由 `<name>.config.json` 承载）。
 */
export function renderDraftJson(answers: DraftStructure): string {
  const s = toDraftStructure(answers)
  const obj = {
    version: DRAFT_SCHEMA_VERSION,
    name: s.name,
    description: s.description,
    phases: s.phases,
    steps: s.steps,
    args: s.args,
  }
  return JSON.stringify(obj, null, 2)
}

/**
 * 防御式解析 `<name>.draft.json` 文本为 {@link DraftStructure}。
 *
 * 降级原则（绝不抛）：
 * - 非法 JSON / 顶层非对象 → 返回 `null`（调用方回退「无草稿」，不可编辑结构）。
 * - 顶层是对象但部分字段缺失/类型不符 → 该字段取安全默认（name="" / description="" /
 *   phases=[] / steps=[] / args=[]），整体仍返回可用结构。
 * - steps 内单个步骤非法 → 跳过该步（不致整次解析失败）。
 *
 * @param text 文件文本（调用方负责读盘；缺失文件应在外层返回 null 而非传空串）。
 */
export function parseDraftJson(text: string): DraftStructure | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  return {
    name: asString(obj.name),
    description: asString(obj.description),
    phases: asStringArray(obj.phases),
    steps: asSteps(obj.steps),
    args: asStringArray(obj.args),
  }
}

// ============================================================================
// 内部：类型守卫与归一（纯）
// ============================================================================

function asString(v: unknown): string {
  return typeof v === "string" ? v : ""
}

function asOptionalString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === "string")
}

function asOptionalNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

function asOptionalBoolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined
}

function asKind(v: unknown): StepKind {
  return typeof v === "string" && STEP_KINDS.has(v as StepKind) ? (v as StepKind) : "single"
}

/** 解析 steps 数组：逐项校验，非对象项跳过。 */
function asSteps(v: unknown): ScaffoldStep[] {
  if (!Array.isArray(v)) return []
  const out: ScaffoldStep[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    out.push(asStep(raw as Record<string, unknown>))
  }
  return out
}

/** 解析单个步骤（仅保留出现且合法的可选字段，深拷贝 branches/dimensions）。 */
function asStep(o: Record<string, unknown>): ScaffoldStep {
  const step: ScaffoldStep = {
    phase: asString(o.phase),
    kind: asKind(o.kind),
    label: asString(o.label),
    intent: asString(o.intent),
    useConfig: asStringArray(o.useConfig),
  }
  const id = asOptionalString(o.id)
  if (id !== undefined) step.id = id
  const subflowName = asOptionalString(o.subflowName)
  if (subflowName !== undefined) step.subflowName = subflowName
  const fanout = asOptionalNumber(o.fanout)
  if (fanout !== undefined) step.fanout = fanout
  const maxRounds = asOptionalNumber(o.maxRounds)
  if (maxRounds !== undefined) step.maxRounds = maxRounds
  const agentType = asOptionalString(o.agentType)
  if (agentType !== undefined) step.agentType = agentType
  const usePrev = asOptionalBoolean(o.usePrev)
  if (usePrev !== undefined) step.usePrev = usePrev
  if (Array.isArray(o.useSteps)) step.useSteps = asStringArray(o.useSteps)
  if (Array.isArray(o.branches)) step.branches = asBranches(o.branches)
  if (Array.isArray(o.dimensions)) step.dimensions = asDimensions(o.dimensions)
  return step
}

function asBranches(v: unknown[]): BranchSpec[] {
  const out: BranchSpec[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const o = raw as Record<string, unknown>
    const branch: BranchSpec = { label: asString(o.label), intent: asString(o.intent) }
    const useConfig = asStringArray(o.useConfig)
    if (useConfig.length > 0) branch.useConfig = useConfig
    const agentType = asOptionalString(o.agentType)
    if (agentType !== undefined) branch.agentType = agentType
    out.push(branch)
  }
  return out
}

function asDimensions(v: unknown[]): DimensionSpec[] {
  const out: DimensionSpec[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const o = raw as Record<string, unknown>
    const dim: DimensionSpec = { name: asString(o.name), intent: asString(o.intent) }
    const useConfig = asStringArray(o.useConfig)
    if (useConfig.length > 0) dim.useConfig = useConfig
    const agentType = asOptionalString(o.agentType)
    if (agentType !== undefined) dim.agentType = agentType
    out.push(dim)
  }
  return out
}

/** 深拷贝单个步骤（序列化前防止与向导状态共享引用）。 */
function cloneStep(step: ScaffoldStep): ScaffoldStep {
  const copy: ScaffoldStep = {
    phase: step.phase,
    kind: step.kind,
    label: step.label,
    intent: step.intent,
    useConfig: Array.isArray(step.useConfig) ? step.useConfig.slice() : [],
  }
  if (step.id !== undefined) copy.id = step.id
  if (step.subflowName !== undefined) copy.subflowName = step.subflowName
  if (step.fanout !== undefined) copy.fanout = step.fanout
  if (step.maxRounds !== undefined) copy.maxRounds = step.maxRounds
  if (step.agentType !== undefined) copy.agentType = step.agentType
  if (step.usePrev !== undefined) copy.usePrev = step.usePrev
  if (step.useSteps !== undefined) copy.useSteps = step.useSteps.slice()
  if (step.branches !== undefined) {
    copy.branches = step.branches.map((b) => ({
      label: b.label,
      intent: b.intent,
      ...(b.useConfig !== undefined ? { useConfig: b.useConfig.slice() } : {}),
      ...(b.agentType !== undefined ? { agentType: b.agentType } : {}),
    }))
  }
  if (step.dimensions !== undefined) {
    copy.dimensions = step.dimensions.map((d) => ({
      name: d.name,
      intent: d.intent,
      ...(d.useConfig !== undefined ? { useConfig: d.useConfig.slice() } : {}),
      ...(d.agentType !== undefined ? { agentType: d.agentType } : {}),
    }))
  }
  return copy
}
