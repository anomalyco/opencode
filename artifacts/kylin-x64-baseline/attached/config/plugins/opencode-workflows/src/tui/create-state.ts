/**
 * OpenCode Workflows —— workflow-create-studio 向导纯归约器（create-state.ts）。
 *
 * 承载全部可纯函数化的状态转移与校验：无副作用、不读文件、不碰 UI、不发网络请求。
 * `/agent` 列表与既有配置回填等异步数据，由 create-screen 拉取后经 `SET_AGENT_OPTIONS` /
 * `LOAD_CONFIG` action 喂入归约器；归约器只对「已在 state 里的数据」做纯变换。
 *
 * 设计要点（design.md「create-state.ts（向导纯归约器）」与「Correctness Properties」）：
 * - `reduce` 纯、不可变（绝不修改入参，仅对被触及的嵌套结构创建新副本）、确定性。
 * - 导航（GOTO/NEXT/BACK）仅移动 `mainStep`，`answers`/`config` 始终深相等；NEXT 受 `validateStep` 门控。
 * - steps/phases/resources 三套列表子状态机（ADD/EDIT/DELETE/MOVE/SET_FIELD/COMMIT/CANCEL）。
 * - 派生纯函数：`validateStep` / `toAnswers` / `toConfigBlock` / `stepSummaries` /
 *   `scanAskRule` / `filterAgents` / `firstInvalidStep`。
 *
 * name 步校验复用 `scaffold.ts` 的 `validateName`（零改动）。
 *
 * @see ../../.kiro/specs/workflow-create-studio/design.md
 * Requirements: 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 4.1, 4.2, 4.3, 4.5, 5.1-5.8, 6.6, 12.1, 12.5, 12.6, 13.3, 14.2, 14.3, 15.1, 18.x
 */

import type {
  AgentChoice,
  BranchSpec,
  ConfigDraft,
  ConfigValue,
  DimensionSpec,
  RawConfigBlock,
  ResourceDraft,
  ResourceEntry,
  ScaffoldAnswers,
  ScaffoldStep,
  StepDraft,
  StepKind,
  StepSummary,
  StepValidation,
  WizardAction,
  WizardState,
  WizardStep,
} from "../types"
import { validateName } from "./scaffold"

// ============================================================================
// 常量
// ============================================================================

/** 向导主步骤规范顺序（新建流）。资源绑定(config)前置于 steps：步骤需引用已声明的资源类别，
 *  故"先声明资源、再接线步骤"（资源/配置心智与向导顺序.md）。 */
const CREATE_STEP_ORDER: WizardStep[] = ["name", "desc", "phases", "config", "steps", "args", "confirm"]

/** 编辑已有 wf 配置时的步骤顺序（仅 config/confirm 两步，R13）。 */
const EDIT_STEP_ORDER: WizardStep[] = ["config", "confirm"]

/** 全部主步骤规范顺序（stepSummaries 投影用）。 */
const ALL_STEPS: WizardStep[] = ["name", "desc", "phases", "config", "steps", "args", "confirm"]

/** 「首个非法步骤」游标顺序：仅可被个体判定的数据步（按可见顺序：config 先于 steps）。 */
const CURSOR_INVALID_ORDER: WizardStep[] = ["name", "config", "steps"]

/** 左栏摘要截断上限（design.md Property 3：summary 不超过截断上限）。 */
const MAX_SUMMARY_LEN = 120

/** 各步左栏标题。 */
const STEP_TITLES: Record<WizardStep, string> = {
  name: "名称",
  desc: "描述",
  phases: "阶段",
  config: "资源绑定",
  steps: "步骤",
  args: "参数",
  confirm: "确认生成",
}

/** 默认回退阶段（空 phases 语义）。 */
const DEFAULT_PHASE = "Main"

// ============================================================================
// 工具（纯）
// ============================================================================

/** 当前模式下的步骤顺序。edit-structure 与 create 同为完整 7 步（方案 C）。 */
function stepOrder(mode: WizardState["mode"]): WizardStep[] {
  return mode === "edit" ? EDIT_STEP_ORDER : CREATE_STEP_ORDER
}

/** 有效阶段集合：空 phases 回退 ["Main"]。 */
function effectivePhases(phases: string[]): string[] {
  return phases.length > 0 ? phases : [DEFAULT_PHASE]
}

/** 删除数组第 index 项（越界则返回原数组引用，不修改入参）。 */
function removeAt<T>(arr: readonly T[], index: number): T[] {
  if (index < 0 || index >= arr.length) return arr.slice()
  return arr.filter((_, k) => k !== index)
}

/** 交换第 index 项与相邻项（越界则返回原数组引用，不修改入参；多重集不变）。 */
function swapAdjacent<T>(arr: readonly T[], index: number, dir: -1 | 1): T[] {
  const j = index + dir
  if (index < 0 || index >= arr.length || j < 0 || j >= arr.length) return arr.slice()
  const copy = arr.slice()
  const tmp = copy[index]
  copy[index] = copy[j]
  copy[j] = tmp
  return copy
}

/** 截断字符串到 ≤ max（含省略号，最终长度恰为 max）。 */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, max - 1) + "…"
}

/** ConfigValue → string[] 归一（none/空/未配置不在此处特判，纯结构归一）。 */
function normalizeConfigValue(value: ConfigValue | undefined): string[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value.slice() : [value]
}

/** 判断 outputPath 是否已配置（非空 string 或非空字典）。 */
function hasOutputPath(outputPath: string | Record<string, string>): boolean {
  if (typeof outputPath === "string") return outputPath.length > 0
  return typeof outputPath === "object" && Object.keys(outputPath).length > 0
}

/** 深拷贝单个分支规格（含其内部 useConfig 数组），避免草稿与原步骤共享引用。 */
function cloneBranch(br: BranchSpec): BranchSpec {
  const copy: BranchSpec = { label: br.label, intent: br.intent }
  if (br.useConfig !== undefined) copy.useConfig = br.useConfig.slice()
  if (br.agentType !== undefined) copy.agentType = br.agentType
  return copy
}

/** 深拷贝单个维度规格（含其内部 useConfig 数组），避免草稿与原步骤共享引用。 */
function cloneDimension(dim: DimensionSpec): DimensionSpec {
  const copy: DimensionSpec = { name: dim.name, intent: dim.intent }
  if (dim.useConfig !== undefined) copy.useConfig = dim.useConfig.slice()
  if (dim.agentType !== undefined) copy.agentType = dim.agentType
  return copy
}

/** branches 预填：三路异构检索（R7.1）。 */
function defaultBranchPrefill(): BranchSpec[] {
  return [
    {
      label: "模板读取",
      intent: "读取并提炼文档/代码模板的章节结构作为本阶段模板。",
      useConfig: ["template"],
      agentType: "librarian",
    },
    {
      label: "规约检索",
      intent: "检索并提炼工程规约与约束为要点清单。",
      useConfig: ["rules"],
      agentType: "librarian",
    },
    {
      label: "代码库分析",
      intent: "通过 grep/glob 分析当前代码库结构与现有模式，返回目录摘要与关键文件列表。",
      agentType: "explore",
    },
  ]
}

/** 多维 gate 预填：默认三维度（R7.2）。 */
function defaultDimensionPrefill(): DimensionSpec[] {
  return [
    { name: "模板遵循", intent: "审查产物是否遵循模板的章节结构与格式。", agentType: "momus" },
    { name: "规约遵循", intent: "审查产物是否遵循工程规约与约束。", agentType: "momus" },
    { name: "自定义", intent: "按本阶段自定义标准审查产物。", agentType: "momus" },
  ]
}

/** 新建步骤草稿（默认值）。不预设 branches/dimensions（留给 kind 切换预填，R6.7）。 */
export function defaultStepDraft(state: WizardState): StepDraft {
  const phases = effectivePhases(state.answers.phases)
  return { phase: phases[0], kind: "single", label: "", intent: "", useConfig: [] }
}

/** 步骤稳定 id 形如 `step-<n>`；用于解析既有 id 的最大序号。 */
const STEP_ID_RE = /^step-(\d+)$/

/**
 * 据「已用 id 集合」生成下一个稳定步骤 id（`step-<max+1>`，确定性、唯一）。
 *
 * 仅解析形如 `step-<n>` 的既有 id 取最大序号 +1；非该形态的自定义 id（如 "plan"）不参与计数，
 * 但仍计入唯一性集合。供 STEP_COMMIT 为缺 id 的步骤自动分配引用锚（A2-full 路径 A）。
 */
function nextStepId(usedIds: ReadonlySet<string>): string {
  let max = 0
  for (const id of usedIds) {
    const m = STEP_ID_RE.exec(id)
    if (m) {
      const n = Number(m[1])
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  let n = max + 1
  while (usedIds.has(`step-${n}`)) n += 1
  return `step-${n}`
}

/**
 * 为缺 id 的步骤补齐稳定 id（A2-full）：已有 id 的步骤原样保留（引用稳定），
 * 仅对 `id` 缺失/空的步骤按 `nextStepId` 分配。无变更则返回原数组引用（不可变）。
 */
function ensureStepIds(steps: readonly ScaffoldStep[]): ScaffoldStep[] {
  const used = new Set<string>()
  for (const s of steps) if (typeof s.id === "string" && s.id.length > 0) used.add(s.id)
  let changed = false
  const out = steps.map((s) => {
    if (typeof s.id === "string" && s.id.length > 0) return s
    const id = nextStepId(used)
    used.add(id)
    changed = true
    return { ...s, id }
  })
  return changed ? out : steps.slice()
}

/** 把已有 ScaffoldStep 拷贝为可编辑草稿（branches/dimensions 深拷贝，R6.5）。 */
export function stepToDraft(step: ScaffoldStep): StepDraft {
  const draft: StepDraft = {
    phase: step.phase,
    kind: step.kind,
    label: step.label,
    intent: step.intent,
    subflowName: step.subflowName,
    useConfig: Array.isArray(step.useConfig) ? step.useConfig.slice() : [],
    fanout: step.fanout,
    maxRounds: step.maxRounds,
    agentType: step.agentType,
    usePrev: step.usePrev,
    id: step.id,
    useSteps: Array.isArray(step.useSteps) ? step.useSteps.slice() : undefined,
  }
  if (step.branches !== undefined) draft.branches = step.branches.map(cloneBranch)
  if (step.dimensions !== undefined) draft.dimensions = step.dimensions.map(cloneDimension)
  // 质量模式专属字段（adversarial / finder-loop / judge-panel）携带进草稿；perspectives 深拷贝数组。
  if (step.threshold !== undefined) draft.threshold = step.threshold
  if (step.convergenceRounds !== undefined) draft.convergenceRounds = step.convergenceRounds
  if (step.perspectives !== undefined) draft.perspectives = [...step.perspectives]
  if (step.synthesis !== undefined) draft.synthesis = step.synthesis
  return draft
}

/** 把草稿固化为已提交步骤（仅保留已设置的可选字段；branches/dimensions 非 undefined 时深拷贝写回，R6.6）。 */
export function draftToStep(draft: StepDraft): ScaffoldStep {
  const step: ScaffoldStep = {
    phase: draft.phase,
    kind: draft.kind,
    label: draft.label,
    intent: draft.intent,
    useConfig: Array.isArray(draft.useConfig) ? draft.useConfig.slice() : [],
  }
  if (draft.subflowName !== undefined) step.subflowName = draft.subflowName
  if (draft.fanout !== undefined) step.fanout = draft.fanout
  if (draft.maxRounds !== undefined) step.maxRounds = draft.maxRounds
  if (draft.agentType !== undefined) step.agentType = draft.agentType
  if (draft.usePrev !== undefined) step.usePrev = draft.usePrev
  if (typeof draft.id === "string" && draft.id.length > 0) step.id = draft.id
  if (Array.isArray(draft.useSteps) && draft.useSteps.length > 0) step.useSteps = draft.useSteps.slice()
  if (draft.branches !== undefined) step.branches = draft.branches.map(cloneBranch)
  if (draft.dimensions !== undefined) step.dimensions = draft.dimensions.map(cloneDimension)
  // 质量模式专属字段写回（往返一致）；perspectives 深拷贝数组。
  if (draft.threshold !== undefined) step.threshold = draft.threshold
  if (draft.convergenceRounds !== undefined) step.convergenceRounds = draft.convergenceRounds
  if (draft.perspectives !== undefined) step.perspectives = [...draft.perspectives]
  if (draft.synthesis !== undefined) step.synthesis = draft.synthesis
  return step
}

/** 新建资源类别草稿（默认值）。 */
function defaultResourceDraft(): ResourceDraft {
  return { phase: "", category: "", paths: [], label: "" }
}

/** 展平后的资源条目（含归属阶段，供索引式 UI 操作 RES_EDIT/DELETE/MOVE 使用）。 */
interface FlatResource {
  phase: string
  category: string
  paths: string[]
  label: string
}

/**
 * 把 per-phase 嵌套资源字典展平为有序数组（阶段顺序 × 阶段内类别顺序）。
 *
 * 资源编辑器（RES_* actions）以「扁平索引」操作，但底层数据是 per-phase 嵌套字典；
 * 本函数提供二者之间的桥接：UI 看到的是一个线性列表，每项记录其归属阶段。
 */
function flattenResources(
  resources: Record<string, Record<string, string[]>>,
  labels: Record<string, Record<string, string>>,
): FlatResource[] {
  const out: FlatResource[] = []
  for (const [phase, categories] of Object.entries(resources)) {
    for (const [category, paths] of Object.entries(categories)) {
      out.push({
        phase,
        category,
        paths: Array.isArray(paths) ? paths.slice() : [],
        label: labels[phase]?.[category] ?? "",
      })
    }
  }
  return out
}

/** 把展平资源数组重建为 per-phase 嵌套字典（保留阶段与类别顺序，空阶段不写）。 */
function rebuildPerPhase(flat: FlatResource[]): {
  resources: Record<string, Record<string, string[]>>
  resourceLabels: Record<string, Record<string, string>>
} {
  const resources: Record<string, Record<string, string[]>> = {}
  const resourceLabels: Record<string, Record<string, string>> = {}
  for (const entry of flat) {
    if (!entry.category || entry.category.trim().length === 0) continue
    if (!resources[entry.phase]) resources[entry.phase] = {}
    resources[entry.phase][entry.category] = entry.paths.slice()
    if (entry.label && entry.label.length > 0) {
      if (!resourceLabels[entry.phase]) resourceLabels[entry.phase] = {}
      resourceLabels[entry.phase][entry.category] = entry.label
    }
  }
  return { resources, resourceLabels }
}

/** 新增资源类别的默认归属阶段（首个声明阶段，空 phases 回退 Main）。 */
function defaultResourcePhase(state: WizardState): string {
  return effectivePhases(state.answers.phases)[0]
}

/**
 * 把回填的 ConfigDraft 按「脚本声明阶段」重新归键（自愈历史错配，方案 A）。
 *
 * 背景：编辑配置模式回填的 `<name>.config.json` 里的阶段键可能与脚本 `meta.phases` 声明的阶段
 * 不一致（历史迁移遗留，如脚本声明 "PRD" 但配置里挂在 "code"/"Main"）。这些「孤儿阶段」的配置
 * 在 per-phase UI 里既显示错乱、又因脚本读不到对应阶段而失效。本函数把孤儿阶段的配置重映射到
 * 声明阶段：
 * - 阶段键 ∈ declaredPhases → 原样保留；
 * - 阶段键 ∉ declaredPhases（孤儿）→ 合并到首个声明阶段 declaredPhases[0]。
 *
 * 合并语义：resources 同类别跨阶段合并路径（去重、保序）；resourceLabels/outputPath/maxReviewRounds
 * 为「首次写入优先」（确定性，按原阶段键迭代序）。declaredPhases 为空时不归键（原样返回）。
 */
function rekeyConfigDraft(config: ConfigDraft, declaredPhases: string[]): ConfigDraft {
  if (declaredPhases.length === 0) return config
  const target = declaredPhases[0]
  const declared = new Set(declaredPhases)
  const destOf = (phase: string): string => (declared.has(phase) ? phase : target)

  const resources: Record<string, Record<string, string[]>> = {}
  for (const [phase, categories] of Object.entries(config.resources)) {
    const dest = destOf(phase)
    if (!resources[dest]) resources[dest] = {}
    for (const [category, paths] of Object.entries(categories)) {
      if (resources[dest][category]) {
        const merged = resources[dest][category].slice()
        for (const p of paths) if (!merged.includes(p)) merged.push(p)
        resources[dest][category] = merged
      } else {
        resources[dest][category] = paths.slice()
      }
    }
  }

  const resourceLabels: Record<string, Record<string, string>> = {}
  for (const [phase, labels] of Object.entries(config.resourceLabels)) {
    const dest = destOf(phase)
    if (!resourceLabels[dest]) resourceLabels[dest] = {}
    for (const [category, label] of Object.entries(labels)) {
      // 首次写入优先（不覆盖已映射的同类别标签）。
      if (!(category in resourceLabels[dest])) resourceLabels[dest][category] = label
    }
  }

  const outputPath: Record<string, string> = {}
  for (const [phase, path] of Object.entries(config.outputPath)) {
    const dest = destOf(phase)
    if (!(dest in outputPath)) outputPath[dest] = path
  }

  const maxReviewRounds: Record<string, string> = {}
  for (const [phase, rounds] of Object.entries(config.maxReviewRounds)) {
    const dest = destOf(phase)
    if (!(dest in maxReviewRounds)) maxReviewRounds[dest] = rounds
  }

  return { resources, resourceLabels, outputPath, maxReviewRounds }
}

/** 把已有 ResourceEntry 拷贝为可编辑草稿。 */
function entryToResourceDraft(entry: ResourceEntry): ResourceDraft {
  return { phase: "", category: entry.category, paths: entry.paths.slice(), label: entry.label }
}

/** 把资源草稿固化为已提交条目。 */
function resourceDraftToEntry(draft: ResourceDraft): ResourceEntry {
  return { category: draft.category, paths: draft.paths.slice(), label: draft.label }
}

// ============================================================================
// 分步校验（validateStep）
// ============================================================================

/** steps 步校验：至少 1 步；每步 phase ∈ phases；subflow 须 subflowName 非空。 */
function validateSteps(state: WizardState): StepValidation {
  const phases = effectivePhases(state.answers.phases)
  const steps = state.answers.steps
  if (steps.length < 1) return { ok: false, reason: "至少需要定义 1 个步骤" }
  // useSteps 引用校验用：累积「当前步之前」已声明的步骤 id 集合（只能引用更早的步）。
  const earlierIds = new Set<string>()
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    if (!phases.includes(s.phase)) {
      return { ok: false, reason: `步骤 ${i + 1} 的归属阶段 "${s.phase}" 不在已声明阶段内` }
    }
    // useSteps（具名多上游引用，路径 A）：每个引用的 id 必须是更早某步的 id；禁前向/自引用。
    if (Array.isArray(s.useSteps)) {
      for (const ref of s.useSteps) {
        if (typeof ref !== "string" || ref.length === 0) continue
        if (!earlierIds.has(ref)) {
          return {
            ok: false,
            reason: `步骤 ${i + 1} 引用的上游步 "${ref}" 不存在或不在其之前（useSteps 只能引用更早的步）`,
          }
        }
      }
    }
    if (s.kind === "subflow" && (!s.subflowName || s.subflowName.length === 0)) {
      return { ok: false, reason: `步骤 ${i + 1} 为 subflow，需指定 subflowName` }
    }
    if (s.kind === "branches") {
      const branches = Array.isArray(s.branches) ? s.branches : []
      if (branches.length < 1) {
        return { ok: false, reason: `步骤 ${i + 1} 为 branches，至少需要 1 个分支` }
      }
      if (branches.some((b) => !b.intent || b.intent.trim().length === 0)) {
        return { ok: false, reason: `步骤 ${i + 1} 存在 intent 为空的分支，每个分支的 intent 不能为空` }
      }
    }
    if (s.kind === "gate" && Array.isArray(s.dimensions) && s.dimensions.length > 0) {
      if (s.dimensions.some((d) => !d.name || d.name.trim().length === 0)) {
        return { ok: false, reason: `步骤 ${i + 1} 多维门控存在维度名为空` }
      }
    }
    // 本步 id 加入「更早集合」，供后续步的 useSteps 引用（只能引用更早的步）。
    if (typeof s.id === "string" && s.id.length > 0) earlierIds.add(s.id)
  }
  return { ok: true }
}

/** config 步校验：资源类别名非空、不重复；无被步骤引用但未声明的类别（断层检测，R12.6）。 */
function validateConfig(state: WizardState): StepValidation {
  const seen = new Set<string>()
  // 遍历嵌套字典收集所有已声明类别
  for (const [phase, categories] of Object.entries(state.config.resources)) {
    if (typeof phase !== "string") continue
    for (const category of Object.keys(categories)) {
      if (!category || category.trim().length === 0) {
        return { ok: false, reason: "资源类别名不能为空" }
      }
      if (seen.has(category)) {
        return { ok: false, reason: `资源类别名重复：${category}` }
      }
      seen.add(category)
    }
  }
  // 断层检测：任一步骤 useConfig 引用了未声明类别 → 不通过且 reason 指出该类别（R12.6）。
  const declared = seen
  for (const step of state.answers.steps) {
    const used = Array.isArray(step.useConfig) ? step.useConfig : []
    for (const category of used) {
      if (!declared.has(category)) {
        return { ok: false, reason: `步骤引用了未声明的资源类别：${category}（请在配置步骤声明，或移除该引用）` }
      }
    }
  }
  return { ok: true }
}

/** confirm 步聚合校验：name + steps（≥1 且每步合法）+ config（无未声明引用）全部合法。 */
function validateConfirm(state: WizardState): StepValidation {
  const nameRes = validateName(state.answers.name, namesForValidation(state))
  if (!nameRes.ok) return nameRes
  const stepsRes = validateSteps(state)
  if (!stepsRes.ok) return stepsRes
  const configRes = validateConfig(state)
  if (!configRes.ok) return configRes
  return { ok: true }
}

/**
 * 分步校验纯函数：决定 NEXT 是否放行；confirm 步做聚合校验。
 *
 * - name：复用 `validateName`（含 ok 与失败 reason，R4.5/R18）。
 * - desc/args：恒通过（可空）。
 * - phases：恒通过（空回退 Main，R5.8）。
 * - steps：≥1 步；每步 phase ∈ phases；subflow 须 subflowName（R5.7）。
 * - config：类别名非空不重复 + 未声明引用断层检测（R12.6）。
 * - confirm：聚合 name + steps + config（R4/R12.6）。
 */
export function validateStep(state: WizardState): StepValidation {
  switch (state.mainStep) {
    case "name":
      // edit-structure：name 为既有 wf 名（必在 registeredNames 内），编辑时排除自身避免误判重名。
      return validateName(state.answers.name, namesForValidation(state))
    case "desc":
    case "args":
    case "phases":
      return { ok: true }
    case "steps":
      return validateSteps(state)
    case "config":
      return validateConfig(state)
    case "confirm":
      return validateConfirm(state)
    default:
      return { ok: true }
  }
}

/** 校验重名用的已注册名集合：edit-structure 下排除被编辑 wf 自身（其名必在集合内）。 */
function namesForValidation(state: WizardState): ReadonlySet<string> {
  if (state.mode !== "edit-structure") return state.registeredNames
  const self = state.answers.name
  if (!state.registeredNames.has(self)) return state.registeredNames
  const next = new Set(state.registeredNames)
  next.delete(self)
  return next
}

/**
 * 定位按游标顺序最早的非法步骤（Ctrl+S 用，R6.6）；全部合法返回 null。
 * 仅检查可被个体判定的数据步（name < steps < config）。
 */
export function firstInvalidStep(state: WizardState): WizardStep | null {
  for (const step of CURSOR_INVALID_ORDER) {
    if (!validateStep({ ...state, mainStep: step }).ok) return step
  }
  return null
}

// ============================================================================
// 派生投影（toAnswers / toConfigBlock / stepSummaries）
// ============================================================================

/** 把 WizardState 投影为可喂给 renderScript 的 ScaffoldAnswers（纯）。 */
export function toAnswers(state: WizardState): ScaffoldAnswers {
  const resources: Record<string, string[]> = {}
  const resourceLabels: Record<string, string> = {}
  
  // 从嵌套字典中提取所有类别（合并所有阶段的同名类别）
  for (const [phase, categories] of Object.entries(state.config.resources)) {
    if (typeof phase !== "string") continue
    for (const [category, paths] of Object.entries(categories)) {
      if (typeof category !== "string") continue
      if (!resources[category]) {
        resources[category] = []
      }
      // 合并路径（同名类别跨阶段合并，去重）
      const existing = new Set(resources[category])
      for (const p of paths) {
        if (typeof p === "string" && !existing.has(p)) {
          resources[category].push(p)
        }
      }
    }
  }
  
  // 提取 resourceLabels（取任一阶段的标签，优先第一个出现的）
  for (const [phase, labels] of Object.entries(state.config.resourceLabels)) {
    if (typeof phase !== "string") continue
    for (const [category, label] of Object.entries(labels)) {
      if (typeof category === "string" && typeof label === "string" && !resourceLabels[category]) {
        resourceLabels[category] = label
      }
    }
  }
  
  // outputPath: 暂时取第一个非空阶段的值（ScaffoldAnswers 仍为 string | undefined）
  let outputPath: string | undefined = state.answers.outputPath
  for (const path of Object.values(state.config.outputPath)) {
    if (typeof path === "string" && path.length > 0) {
      outputPath = path
      break
    }
  }
  
  return {
    name: state.answers.name,
    description: state.answers.description,
    phases: effectivePhases(state.answers.phases).slice(),
    steps: state.answers.steps.map((s) => draftToStep(stepToDraft(s))),
    resources,
    resourceLabels,
    outputPath,
    args: state.answers.args.slice(),
  }
}

/** 把配置编辑器投影为可喂给 config-writer 的 RawConfigBlock（纯，与 LOAD_CONFIG 往返等价，R13.3）。 */
export function toConfigBlock(state: WizardState): RawConfigBlock {
  const block: RawConfigBlock = {}

  // resources: 保留空数组（让 renderConfigJson 根据 declaredButEmpty 决定如何序列化）
  if (Object.keys(state.config.resources).length > 0) {
    const resources: Record<string, Record<string, ConfigValue>> = {}
    for (const [phase, categories] of Object.entries(state.config.resources)) {
      if (typeof phase !== "string" || phase.length === 0) continue
      const phaseRes: Record<string, ConfigValue> = {}
      for (const [category, paths] of Object.entries(categories)) {
        if (typeof category !== "string" || category.length === 0) continue
        // 保留空数组，不过滤（R12.3: 空数组类别需要被 renderConfigJson 写为 "none"）
        if (Array.isArray(paths)) {
          phaseRes[category] = paths
        }
      }
      if (Object.keys(phaseRes).length > 0) {
        resources[phase] = phaseRes
      }
    }
    if (Object.keys(resources).length > 0) {
      block.resources = resources
    }
  }

  // resourceLabels: 同理
  if (Object.keys(state.config.resourceLabels).length > 0) {
    const resourceLabels: Record<string, Record<string, string>> = {}
    for (const [phase, labels] of Object.entries(state.config.resourceLabels)) {
      if (typeof phase !== "string" || phase.length === 0) continue
      const phaseLabels: Record<string, string> = {}
      for (const [category, label] of Object.entries(labels)) {
        if (typeof category !== "string" || category.length === 0) continue
        if (typeof label === "string" && label.length > 0) {
          phaseLabels[category] = label
        }
      }
      if (Object.keys(phaseLabels).length > 0) {
        resourceLabels[phase] = phaseLabels
      }
    }
    if (Object.keys(resourceLabels).length > 0) {
      block.resourceLabels = resourceLabels
    }
  }

  // output_path: 过滤非空值
  if (Object.keys(state.config.outputPath).length > 0) {
    const outputPath: Record<string, string> = {}
    for (const [phase, path] of Object.entries(state.config.outputPath)) {
      if (typeof phase !== "string" || phase.length === 0) continue
      if (typeof path === "string" && path.length > 0) {
        outputPath[phase] = path
      }
    }
    if (Object.keys(outputPath).length > 0) {
      block.output_path = outputPath
    }
  }

  // max_review_rounds: 转数字并过滤非法值
  if (Object.keys(state.config.maxReviewRounds).length > 0) {
    const maxReviewRounds: Record<string, number> = {}
    for (const [phase, str] of Object.entries(state.config.maxReviewRounds)) {
      if (typeof phase !== "string" || phase.length === 0) continue
      if (typeof str !== "string") continue
      const n = Number(str)
      if (Number.isFinite(n)) {
        maxReviewRounds[phase] = n
      }
    }
    if (Object.keys(maxReviewRounds).length > 0) {
      block.max_review_rounds = maxReviewRounds
    }
  }

  return block
}

/** 某步「已填值摘要」原文（未截断）。 */
function summaryFor(step: WizardStep, state: WizardState): string {
  const a = state.answers
  switch (step) {
    case "name":
      return a.name ?? ""
    case "desc":
      return a.description ?? ""
    case "phases":
      return effectivePhases(a.phases).join(", ")
    case "steps":
      return a.steps.length > 0 ? `${a.steps.length} 步` : "（无步骤）"
    case "config": {
      // 统计所有阶段的资源类别总数
      let count = 0
      for (const categories of Object.values(state.config.resources)) {
        if (categories && typeof categories === "object") {
          count += Object.keys(categories).length
        }
      }
      const hasOutput = hasOutputPath(state.config.outputPath)
      if (count > 0) return hasOutput ? `${count} 类资源 + 落盘` : `${count} 类资源`
      return hasOutput ? "落盘" : "（无配置）"
    }
    case "args":
      return a.args.length > 0 ? a.args.join(", ") : "—"
    case "confirm":
      return "确认并生成"
    default:
      return ""
  }
}

/**
 * 左栏每步的「完成图标 + 已填摘要」（纯，R2）。
 *
 * 覆盖全部主步骤（规范顺序）；当前步（mainStep）为唯一 `current`，其前为 `done`、其后为 `todo`；
 * 每项 summary 截断到 ≤ MAX_SUMMARY_LEN。
 */
export function stepSummaries(state: WizardState): StepSummary[] {
  const currentIdx = ALL_STEPS.indexOf(state.mainStep)
  return ALL_STEPS.map((step, i) => {
    let icon: "done" | "current" | "todo"
    if (i === currentIdx) icon = "current"
    else if (currentIdx >= 0 && i < currentIdx) icon = "done"
    else icon = "todo"
    return {
      step,
      icon,
      title: STEP_TITLES[step],
      summary: truncate(summaryFor(step, state), MAX_SUMMARY_LEN),
    }
  })
}

// ============================================================================
// config 步阶段分组树行模型（buildConfigRows）—— 改动 A
// ============================================================================

/**
 * config 步「阶段分组树」的扁平行（供渲染与键盘导航共用单一真相）。
 *
 * 资源不再平铺为一条连续列表，而是按**已声明阶段**分组、可折叠/展开：
 * - `phase-header`：阶段标题行，`Enter` 折叠/展开；折叠时其下类别行与「新增类别」行不出现。
 * - `resource`：某阶段下的资源类别行（仅展开时出现）。`globalIndex` 与 reducer 的
 *   `flattenResources`（`Object.entries(resources)` 顺序）严格对齐，RES_EDIT/DELETE/MOVE 以此索引。
 * - `add-category`：某阶段下的「新增类别」行（仅展开时出现，末尾）；`a`/Enter 触发
 *   `RES_ADD{ phase }`，归属阶段自动填入，故资源子表单无需再选阶段。
 * - `out-phase` / `output-path` / `max-review-rounds`：落盘/轮次的 per-phase 配置行（树之后）。
 */
export type ConfigRow =
  | { kind: "phase-header"; phase: string; categoryCount: number; expanded: boolean }
  | { kind: "resource"; phase: string; category: string; paths: string[]; label: string; globalIndex: number }
  | { kind: "add-category"; phase: string }
  | { kind: "out-phase" }
  | { kind: "output-path" }
  | { kind: "max-review-rounds" }

/**
 * 构造 config 步的阶段分组树行模型（**纯函数**）。
 *
 * 展示顺序：先按已声明阶段顺序（`answers.phases`，空回退 ["Main"]），再追加任何「不在声明阶段内、
 * 但 resources 字典里仍有」的孤儿阶段（保证资源永不被隐藏）。每个阶段是否展开由 `collapsed`
 * 反向决定（不在 `collapsed` 集合内 → 展开）。
 *
 * `resource` 行的 `globalIndex` 通过预先扫描 `flattenResources` 建立 (阶段+类别)→索引 映射获得，
 * 因此**展示顺序与索引顺序解耦**：即使按声明阶段顺序展示，索引仍与 reducer 的扁平视图一致，
 * 保证 RES_EDIT/DELETE/MOVE 不错位。
 *
 * @param state     当前向导状态。
 * @param collapsed 已折叠的阶段名集合（缺省全部展开）。
 */
export function buildConfigRows(state: WizardState, collapsed?: ReadonlySet<string>): ConfigRow[] {
  const resources = state.config.resources
  const labels = state.config.resourceLabels
  const declared = effectivePhases(state.answers.phases)

  // 展示阶段顺序：声明阶段优先，孤儿阶段（仅 resources 里有）追加在后。
  const orderedPhases: string[] = declared.slice()
  for (const phase of Object.keys(resources)) {
    if (!orderedPhases.includes(phase)) orderedPhases.push(phase)
  }

  // 与 reducer 的 flattenResources 对齐的 (阶段\u0000类别) → globalIndex 映射。
  const flat = flattenResources(resources, labels)
  const indexOf = new Map<string, number>()
  flat.forEach((f, i) => indexOf.set(`${f.phase}\u0000${f.category}`, i))

  const rows: ConfigRow[] = []
  for (const phase of orderedPhases) {
    const cats = resources[phase] ?? {}
    const catNames = Object.keys(cats)
    const expanded = !(collapsed?.has(phase) ?? false)
    rows.push({ kind: "phase-header", phase, categoryCount: catNames.length, expanded })
    if (!expanded) continue
    for (const category of catNames) {
      rows.push({
        kind: "resource",
        phase,
        category,
        paths: (cats[category] ?? []).slice(),
        label: labels[phase]?.[category] ?? "",
        globalIndex: indexOf.get(`${phase}\u0000${category}`) ?? -1,
      })
    }
    rows.push({ kind: "add-category", phase })
  }
  rows.push({ kind: "out-phase" })
  rows.push({ kind: "output-path" })
  rows.push({ kind: "max-review-rounds" })
  return rows
}

// ============================================================================
// agent 选择（scanAskRule / filterAgents）
// ============================================================================

/**
 * 静态遍历 permission ruleset，判定是否含 action 为 `ask` 的规则（R15.1）。
 * 递归扫描字符串/数组/对象：当且仅当存在某叶子值等于 `"ask"` 时返回 true。
 */
export function scanAskRule(ruleset: unknown): boolean {
  if (ruleset === "ask") return true
  if (Array.isArray(ruleset)) return ruleset.some(scanAskRule)
  if (ruleset && typeof ruleset === "object") {
    return Object.values(ruleset as Record<string, unknown>).some(scanAskRule)
  }
  return false
}

/** filterAgents 的原始输入形状（/agent 端点 Agent.Info 的相关子集）。 */
interface RawAgentInfo {
  name: string
  mode: string
  permission?: unknown
}

/**
 * 过滤可作为 workflow 步骤执行 Agent 的候选：仅保留 mode 为 `subagent`/`all`（剔除 `primary`，R14.2），
 * 并附静态 ask 规则扫描结果（R15.1）。
 */
export function filterAgents(agents: RawAgentInfo[]): AgentChoice[] {
  return agents
    .filter((a) => a.mode === "subagent" || a.mode === "all")
    .map((a) => ({ name: a.name, mode: a.mode as "subagent" | "all", hasAskRule: scanAskRule(a.permission) }))
}

// ============================================================================
// 归约器（reduce）
// ============================================================================

/**
 * 纯归约器：无副作用、不可变（绝不修改入参，仅对被触及的嵌套结构创建新副本）、确定性。
 *
 * - 导航 GOTO/NEXT/BACK 仅移动 `mainStep`，`answers`/`config` 始终深相等（R1.3/R1.4）。
 * - NEXT 受 `validateStep` 门控：失败 → 游标不动 + `stepError` 非空；通过 → 游标前进 + `stepError` 清空（R4）。
 * - steps/phases/resources 三套列表子状态机（R5/R12）。
 * - 除 NEXT 外的动作不触碰 `stepError`（校验失败态下非编辑动作保持提示常驻，R4.3）。
 */
export function reduce(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    // ---- 导航 ----
    case "GOTO":
      return { ...state, mainStep: action.step }

    case "BACK": {
      const order = stepOrder(state.mode)
      const i = order.indexOf(state.mainStep)
      const prev = i <= 0 ? state.mainStep : order[i - 1]
      return { ...state, mainStep: prev }
    }

    case "NEXT": {
      const verdict = validateStep(state)
      if (!verdict.ok) {
        return { ...state, stepError: verdict.reason }
      }
      const order = stepOrder(state.mode)
      const i = order.indexOf(state.mainStep)
      const next = i < 0 ? state.mainStep : order[Math.min(i + 1, order.length - 1)]
      return { ...state, mainStep: next, stepError: null }
    }

    // ---- 字段编辑 ----
    case "SET_NAME":
      return { ...state, answers: { ...state.answers, name: action.value } }

    case "SET_DESC":
      return { ...state, answers: { ...state.answers, description: action.value } }

    case "SET_ARGS": {
      const args = action.value
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      return { ...state, answers: { ...state.answers, args } }
    }

    // 旧的 SET_MAX_REVIEW_ROUNDS 已废弃，被 SET_MAX_REVIEW_ROUNDS_PHASE 取代
    // 保留作为向后兼容（实际上应该删除，但暂时保留避免其他地方引用）
    case "SET_MAX_REVIEW_ROUNDS":
      // 此 action 已废弃，不应再被调用
      return state

    // ---- 纯 per-phase 配置 actions（嵌套字典增删改，空阶段自动清理）----
    case "SET_RESOURCE_PHASE": {
      const { phase, category, paths } = action
      return {
        ...state,
        config: {
          ...state.config,
          resources: {
            ...state.config.resources,
            [phase]: {
              ...(state.config.resources[phase] ?? {}),
              [category]: paths,
            },
          },
        },
      }
    }

    case "DELETE_RESOURCE_PHASE": {
      const { phase, category } = action
      const phaseRes = state.config.resources[phase]
      if (!phaseRes) return state
      if (category === undefined) {
        // 删除整个阶段
        const { [phase]: _, ...rest } = state.config.resources
        return { ...state, config: { ...state.config, resources: rest } }
      }
      // 删除某类别
      const { [category]: __, ...restCat } = phaseRes
      if (Object.keys(restCat).length === 0) {
        // 阶段变空，清理整个阶段
        const { [phase]: _, ...rest } = state.config.resources
        return { ...state, config: { ...state.config, resources: rest } }
      }
      return {
        ...state,
        config: {
          ...state.config,
          resources: { ...state.config.resources, [phase]: restCat },
        },
      }
    }

    case "SET_RESOURCE_LABEL_PHASE": {
      const { phase, category, label } = action
      return {
        ...state,
        config: {
          ...state.config,
          resourceLabels: {
            ...state.config.resourceLabels,
            [phase]: {
              ...(state.config.resourceLabels[phase] ?? {}),
              [category]: label,
            },
          },
        },
      }
    }

    case "SET_OUTPUT_PHASE": {
      return {
        ...state,
        config: {
          ...state.config,
          outputPath: { ...state.config.outputPath, [action.phase]: action.value },
        },
      }
    }

    case "DELETE_OUTPUT_PHASE": {
      const { [action.phase]: _, ...rest } = state.config.outputPath
      return { ...state, config: { ...state.config, outputPath: rest } }
    }

    case "SET_MAX_REVIEW_ROUNDS_PHASE": {
      return {
        ...state,
        config: {
          ...state.config,
          maxReviewRounds: { ...state.config.maxReviewRounds, [action.phase]: action.value },
        },
      }
    }

    case "DELETE_MAX_REVIEW_ROUNDS_PHASE": {
      const { [action.phase]: _, ...rest } = state.config.maxReviewRounds
      return { ...state, config: { ...state.config, maxReviewRounds: rest } }
    }

    // ---- phases 列表（ADD/EDIT 直接携值，无 COMMIT；CANCEL 仅复位编辑器）----
    case "PHASE_ADD":
      return {
        ...state,
        answers: { ...state.answers, phases: [...state.answers.phases, action.value] },
        phaseEditor: { kind: "list" },
      }

    case "PHASE_EDIT": {
      if (action.index < 0 || action.index >= state.answers.phases.length) {
        return { ...state, phaseEditor: { kind: "list" } }
      }
      const phases = state.answers.phases.slice()
      phases[action.index] = action.value
      return { ...state, answers: { ...state.answers, phases }, phaseEditor: { kind: "list" } }
    }

    case "PHASE_DELETE":
      return {
        ...state,
        answers: { ...state.answers, phases: removeAt(state.answers.phases, action.index) },
        phaseEditor: { kind: "list" },
      }

    case "PHASE_MOVE":
      return {
        ...state,
        answers: { ...state.answers, phases: swapAdjacent(state.answers.phases, action.index, action.dir) },
      }

    case "PHASE_CANCEL":
      return { ...state, phaseEditor: { kind: "list" } }

    // ---- steps 子流程 ----
    case "STEP_ADD":
      return {
        ...state,
        stepEditor: { kind: "edit", index: state.answers.steps.length, draft: defaultStepDraft(state) },
      }

    case "STEP_EDIT": {
      if (action.index < 0 || action.index >= state.answers.steps.length) return { ...state }
      return {
        ...state,
        stepEditor: { kind: "edit", index: action.index, draft: stepToDraft(state.answers.steps[action.index]) },
      }
    }

    case "STEP_SET_FIELD": {
      if (state.stepEditor.kind !== "edit") return { ...state }
      const draft: StepDraft = { ...state.stepEditor.draft }
      switch (action.field) {
        case "phase":
          draft.phase = action.value as string
          break
        case "kind": {
          const nextKind = action.value as StepKind
          draft.kind = nextKind
          // kind 切换预填（R7.1/R7.2/R7.3/R7.4）：仅当切到该 kind 且对应列表为空时预填，
          // 已非空则保留用户编辑（切回又切来不覆盖）。
          if (nextKind === "branches" && (!draft.branches || draft.branches.length === 0)) {
            draft.branches = defaultBranchPrefill()
          }
          if (nextKind === "gate" && (!draft.dimensions || draft.dimensions.length === 0)) {
            draft.dimensions = defaultDimensionPrefill()
          }
          // judge-panel 预填 perspectives（仅空时，与 branches/dimensions 同款预填语义）；
          // adversarial/finder-loop 不在归约器层预填，由渲染层 scaffold.ts 默认值兜底（R8.2）。
          if (nextKind === "judge-panel" && (!draft.perspectives || draft.perspectives.length === 0)) {
            draft.perspectives = ["方案完备优先", "风险稳健优先", "用户体验优先"]
          }
          break
        }
        case "subflowName":
          draft.subflowName = action.value as string | undefined
          break
        case "label":
          draft.label = action.value as string
          break
        case "intent":
          draft.intent = action.value as string
          break
        case "useConfig":
          draft.useConfig = Array.isArray(action.value) ? (action.value as string[]).slice() : draft.useConfig
          break
        case "useSteps":
          // 具名多上游引用（A2-full）：仅接受字符串数组；非数组忽略（保持草稿不变）。
          draft.useSteps = Array.isArray(action.value) ? (action.value as string[]).slice() : draft.useSteps
          break
        case "agentType":
          draft.agentType = action.value as string | undefined
          break
        case "fanout":
          draft.fanout = action.value as number | undefined
          break
        case "maxRounds":
          draft.maxRounds = action.value as number | undefined
          break
        case "threshold":
          draft.threshold = action.value as number | undefined
          break
        case "convergenceRounds":
          draft.convergenceRounds = action.value as number | undefined
          break
        case "perspectives":
          // 角度列表整体写回（深拷贝）；非数组忽略（保持草稿不变）。
          draft.perspectives = Array.isArray(action.value) ? (action.value as string[]).slice() : draft.perspectives
          break
        case "synthesis":
          draft.synthesis = action.value as string | undefined
          break
        default:
          break
      }
      return { ...state, stepEditor: { ...state.stepEditor, draft } }
    }

    case "STEP_COMMIT": {
      if (state.stepEditor.kind !== "edit") return { ...state }
      const steps = state.answers.steps.slice()
      let step = draftToStep(state.stepEditor.draft)
      // A2-full：为缺 id 的步骤分配稳定引用锚（基于现有 step id 去重，确定性递增）。
      if (typeof step.id !== "string" || step.id.length === 0) {
        const used = new Set<string>()
        for (const s of steps) if (typeof s.id === "string" && s.id.length > 0) used.add(s.id)
        step = { ...step, id: nextStepId(used) }
      }
      const idx = state.stepEditor.index
      if (idx >= steps.length) steps.push(step)
      else if (idx >= 0) steps[idx] = step
      // 回填任何遗留缺 id 的步骤（保证后续可被 useSteps 引用）。
      const normalized = ensureStepIds(steps)
      return { ...state, answers: { ...state.answers, steps: normalized }, stepEditor: { kind: "list" } }
    }

    case "STEP_CANCEL":
      return { ...state, stepEditor: { kind: "list" } }

    case "STEP_DELETE": {
      // 删到 0 拦截：至少保留 1 步（R5.7）。
      if (state.answers.steps.length <= 1) return { ...state }
      if (action.index < 0 || action.index >= state.answers.steps.length) return { ...state }
      return { ...state, answers: { ...state.answers, steps: removeAt(state.answers.steps, action.index) } }
    }

    case "STEP_MOVE":
      return {
        ...state,
        answers: { ...state.answers, steps: swapAdjacent(state.answers.steps, action.index, action.dir) },
      }

    case "STEP_SET_AGENT": {
      if (state.stepEditor.kind !== "edit") return { ...state }
      return {
        ...state,
        stepEditor: { ...state.stepEditor, draft: { ...state.stepEditor.draft, agentType: action.agentType } },
      }
    }

    // ---- 分支子列表（branches kind 步草稿内，仅触碰 stepEditor.draft.branches，R6.1/R6.3）----
    case "BRANCH_ADD": {
      if (state.stepEditor.kind !== "edit") return { ...state }
      const draft: StepDraft = { ...state.stepEditor.draft }
      draft.branches = [...(draft.branches ?? []), { label: "", intent: "" }]
      return { ...state, stepEditor: { ...state.stepEditor, draft } }
    }

    case "BRANCH_DELETE": {
      if (state.stepEditor.kind !== "edit") return { ...state }
      const list = state.stepEditor.draft.branches ?? []
      if (action.index < 0 || action.index >= list.length) return { ...state }
      const draft: StepDraft = { ...state.stepEditor.draft, branches: removeAt(list, action.index) }
      return { ...state, stepEditor: { ...state.stepEditor, draft } }
    }

    case "BRANCH_MOVE": {
      if (state.stepEditor.kind !== "edit") return { ...state }
      const list = state.stepEditor.draft.branches ?? []
      const j = action.index + action.dir
      if (action.index < 0 || action.index >= list.length || j < 0 || j >= list.length) return { ...state }
      const draft: StepDraft = { ...state.stepEditor.draft, branches: swapAdjacent(list, action.index, action.dir) }
      return { ...state, stepEditor: { ...state.stepEditor, draft } }
    }

    case "BRANCH_SET_FIELD": {
      if (state.stepEditor.kind !== "edit") return { ...state }
      const list = (state.stepEditor.draft.branches ?? []).slice()
      if (action.index < 0 || action.index >= list.length) return { ...state }
      list[action.index] = { ...list[action.index], [action.field]: action.value }
      const draft: StepDraft = { ...state.stepEditor.draft, branches: list }
      return { ...state, stepEditor: { ...state.stepEditor, draft } }
    }

    // BRANCH_EDIT/COMMIT/CANCEL：子编辑器焦点语义（步骤草稿已实时更新，回写由 STEP_COMMIT 统一完成）。
    case "BRANCH_EDIT":
    case "BRANCH_COMMIT":
    case "BRANCH_CANCEL":
      return { ...state }

    // ---- 维度子列表（多维 gate 步草稿内，与 BRANCH_* 同构，R6.2/R6.4）----
    case "DIM_ADD": {
      if (state.stepEditor.kind !== "edit") return { ...state }
      const draft: StepDraft = { ...state.stepEditor.draft }
      draft.dimensions = [...(draft.dimensions ?? []), { name: "", intent: "" }]
      return { ...state, stepEditor: { ...state.stepEditor, draft } }
    }

    case "DIM_DELETE": {
      if (state.stepEditor.kind !== "edit") return { ...state }
      const list = state.stepEditor.draft.dimensions ?? []
      if (action.index < 0 || action.index >= list.length) return { ...state }
      const draft: StepDraft = { ...state.stepEditor.draft, dimensions: removeAt(list, action.index) }
      return { ...state, stepEditor: { ...state.stepEditor, draft } }
    }

    case "DIM_MOVE": {
      if (state.stepEditor.kind !== "edit") return { ...state }
      const list = state.stepEditor.draft.dimensions ?? []
      const j = action.index + action.dir
      if (action.index < 0 || action.index >= list.length || j < 0 || j >= list.length) return { ...state }
      const draft: StepDraft = { ...state.stepEditor.draft, dimensions: swapAdjacent(list, action.index, action.dir) }
      return { ...state, stepEditor: { ...state.stepEditor, draft } }
    }

    case "DIM_SET_FIELD": {
      if (state.stepEditor.kind !== "edit") return { ...state }
      const list = (state.stepEditor.draft.dimensions ?? []).slice()
      if (action.index < 0 || action.index >= list.length) return { ...state }
      list[action.index] = { ...list[action.index], [action.field]: action.value }
      const draft: StepDraft = { ...state.stepEditor.draft, dimensions: list }
      return { ...state, stepEditor: { ...state.stepEditor, draft } }
    }

    // DIM_EDIT/COMMIT/CANCEL：子编辑器焦点语义（步骤草稿已实时更新）。
    case "DIM_EDIT":
    case "DIM_COMMIT":
    case "DIM_CANCEL":
      return { ...state }

    // ---- 资源类别列表（扁平索引 UI ↔ per-phase 嵌套字典桥接）----
    // 资源编辑器以「扁平索引」操作（RES_EDIT/DELETE/MOVE by index），底层数据是 per-phase
    // 嵌套字典。新增类别默认归属首个声明阶段（defaultResourcePhase）。resourceEditor 子状态
    // 维护「正在编辑的草稿」，RES_COMMIT 时写回嵌套字典并重建 per-phase 结构。
    case "RES_ADD": {
      // 打开新增草稿（index = 当前扁平条目数，表示追加）。
      // 阶段分组树视图：action.phase 指定归属阶段（在某阶段的「新增类别」行触发）；
      // 缺省回退首个声明阶段（旧平铺视图语义）。指定阶段须 ∈ 声明阶段，否则回退首个。
      const flat = flattenResources(state.config.resources, state.config.resourceLabels)
      const phases = effectivePhases(state.answers.phases)
      const wanted = typeof action.phase === "string" && action.phase.length > 0 ? action.phase : ""
      const phase = phases.includes(wanted) ? wanted : phases[0]
      return {
        ...state,
        resourceEditor: {
          kind: "edit",
          index: flat.length,
          draft: { ...defaultResourceDraft(), phase },
        },
      }
    }

    case "RES_EDIT": {
      const flat = flattenResources(state.config.resources, state.config.resourceLabels)
      if (action.index < 0 || action.index >= flat.length) return { ...state }
      const e = flat[action.index]
      return {
        ...state,
        resourceEditor: {
          kind: "edit",
          index: action.index,
          draft: { phase: e.phase, category: e.category, paths: e.paths.slice(), label: e.label },
        },
      }
    }

    case "RES_SET_FIELD": {
      if (state.resourceEditor.kind !== "edit") return { ...state }
      const draft: ResourceDraft = { ...state.resourceEditor.draft }
      if (action.field === "phase") draft.phase = String(action.value ?? "")
      else if (action.field === "category") draft.category = String(action.value ?? "")
      else if (action.field === "label") draft.label = String(action.value ?? "")
      else if (action.field === "paths") {
        draft.paths = Array.isArray(action.value)
          ? (action.value as unknown[]).map((v) => String(v)).filter((s) => s.length > 0)
          : []
      }
      return { ...state, resourceEditor: { ...state.resourceEditor, draft } }
    }

    case "RES_COMMIT": {
      if (state.resourceEditor.kind !== "edit") return { ...state }
      const draft = state.resourceEditor.draft
      const category = draft.category.trim()
      // 类别名为空 → 不提交，仅关闭编辑器（与旧版「空类别不入列表」语义一致）。
      if (category.length === 0) {
        return { ...state, resourceEditor: { kind: "list" } }
      }
      const flat = flattenResources(state.config.resources, state.config.resourceLabels)
      const idx = state.resourceEditor.index
      // 归属阶段取草稿值（用户可在编辑器选择）；为空回退首个声明阶段。
      const phase = draft.phase && draft.phase.trim().length > 0 ? draft.phase : defaultResourcePhase(state)
      const entry: FlatResource = {
        phase,
        category,
        paths: draft.paths.slice(),
        label: draft.label,
      }
      if (idx >= 0 && idx < flat.length) flat[idx] = entry
      else flat.push(entry)
      const { resources, resourceLabels } = rebuildPerPhase(flat)
      return {
        ...state,
        config: { ...state.config, resources, resourceLabels },
        resourceEditor: { kind: "list" },
      }
    }

    case "RES_CANCEL":
      return { ...state, resourceEditor: { kind: "list" } }

    case "RES_DELETE": {
      const flat = flattenResources(state.config.resources, state.config.resourceLabels)
      if (action.index < 0 || action.index >= flat.length) return { ...state }
      flat.splice(action.index, 1)
      const { resources, resourceLabels } = rebuildPerPhase(flat)
      return { ...state, config: { ...state.config, resources, resourceLabels } }
    }

    case "RES_MOVE": {
      const flat = flattenResources(state.config.resources, state.config.resourceLabels)
      const moved = swapAdjacent(flat, action.index, action.dir)
      const { resources, resourceLabels } = rebuildPerPhase(moved)
      return { ...state, config: { ...state.config, resources, resourceLabels } }
    }

    // ---- agent 选择器 ----
    case "SET_AGENT_OPTIONS":
      return { ...state, agentOptions: action.options.slice(), agentEndpointAvailable: action.available }

    // ---- 编辑入口回填（RawConfigBlock → ConfigDraft，R13.3）----
    case "LOAD_CONFIG": {
      const block = action.block
      const config: ConfigDraft = {
        resources: {},
        resourceLabels: {},
        outputPath: {},
        maxReviewRounds: {},
      }

      // 回填 resources（嵌套字典）
      if (block.resources && typeof block.resources === "object" && !Array.isArray(block.resources)) {
        for (const [phase, categories] of Object.entries(block.resources)) {
          if (typeof phase !== "string" || !categories || typeof categories !== "object") continue
          config.resources[phase] = {}
          for (const [category, value] of Object.entries(categories as Record<string, unknown>)) {
            if (typeof category !== "string") continue
            const paths = Array.isArray(value) ? value : typeof value === "string" ? [value] : []
            if (paths.length > 0) {
              config.resources[phase][category] = paths as string[]
            }
          }
        }
      }

      // 回填 resourceLabels
      if (block.resourceLabels && typeof block.resourceLabels === "object" && !Array.isArray(block.resourceLabels)) {
        for (const [phase, labels] of Object.entries(block.resourceLabels)) {
          if (typeof phase !== "string" || !labels || typeof labels !== "object") continue
          config.resourceLabels[phase] = {}
          for (const [category, label] of Object.entries(labels as Record<string, unknown>)) {
            if (typeof category === "string" && typeof label === "string") {
              config.resourceLabels[phase][category] = label
            }
          }
        }
      }

      // 回填 output_path
      if (block.output_path && typeof block.output_path === "object" && !Array.isArray(block.output_path)) {
        for (const [phase, path] of Object.entries(block.output_path)) {
          if (typeof phase === "string" && typeof path === "string" && path.length > 0) {
            config.outputPath[phase] = path
          }
        }
      }

      // 回填 max_review_rounds
      if (block.max_review_rounds && typeof block.max_review_rounds === "object" && !Array.isArray(block.max_review_rounds)) {
        for (const [phase, rounds] of Object.entries(block.max_review_rounds)) {
          if (typeof phase === "string" && typeof rounds === "number" && Number.isFinite(rounds)) {
            config.maxReviewRounds[phase] = String(rounds)
          }
        }
      }

      // 方案 A 自愈：用脚本声明阶段（declaredPhases，来自 meta.phases）重新归键，把历史错配的
      // 孤儿阶段（如脚本声明 "PRD" 但配置挂在 "code"/"Main"）合并到首个声明阶段。declaredPhases
      // 缺省（create/edit-structure 不传）时不归键，原样返回（保持既有往返语义）。
      const rekeyed = Array.isArray(action.declaredPhases)
        ? rekeyConfigDraft(config, action.declaredPhases)
        : config

      return { ...state, config: rekeyed }
    }
    case "LOAD_DRAFT": {
      const s = action.structure
      return {
        ...state,
        answers: {
          ...state.answers,
          name: s.name,
          description: s.description,
          phases: Array.isArray(s.phases) ? s.phases.slice() : [],
          steps: Array.isArray(s.steps) ? s.steps.map((st) => draftToStep(stepToDraft(st))) : [],
          args: Array.isArray(s.args) ? s.args.slice() : [],
        },
      }
    }

    // ---- 收尾 ----
    case "SUBMIT":
      return { ...state, finished: true }

    default:
      return { ...state }
  }
}
