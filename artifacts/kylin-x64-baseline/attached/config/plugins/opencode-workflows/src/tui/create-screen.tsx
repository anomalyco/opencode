/** @jsxImportSource @opentui/solid */
/**
 * OpenCode Workflows —— workflow-create-studio 全屏向导（create-screen.tsx，新增）。
 *
 * `/workflows-studio` 的全屏路由 `workflow-studio`（经 Studio 意图菜单进入）：把原「单向对话框链」重构为
 * 「全屏双栏 + 底栏实时脚本预览 + 右栏常驻校验」的有状态向导。本组件是 **薄渲染层**——
 * 「按键 → WizardAction」与「WizardState → 视图」的映射，全部可纯函数化的状态转移/校验
 * 都在 {@link reduce}/{@link validateStep} 等归约器里（create-state.ts），本组件不持有业务规则。
 *
 * 参照 `monitor-screens.tsx` 范式：
 * - `useKeyboard` 首行守卫 `route.current.name !== CREATE_ROUTE` 时不响应（R6.10）；
 * - 全屏 `<box width/height>` 取 `useTerminalDimensions()`，窄屏退化单栏 + 顶部步骤条（R6.9）；
 * - 所有回调包 try/catch，绝不向上抛（Issue #13461 / R17.4）。
 *
 * 文本字段用 `@opentui/core` 的 `<input>`（InputRenderable）：焦点在输入框时方向键/字符/
 * Backspace 交给输入框，仅 Enter/Esc/Tab/Ctrl+S 被向导拦截（R6.3/R6.7）。
 *
 * I/O（写盘 / `/agent` 列举 / 既有配置回填 / 内置默认）一律经注入式 props 进入，
 * 组件内不直接做 FS/网络，便于 mock 与降级。
 *
 * @see .kiro/specs/workflow-create-studio/design.md — Components and Interfaces / 2、界面草图
 * Requirements: 2.1-2.5, 3.1-3.4, 4.1, 4.4, 5.1, 5.2, 6.1-6.10, 11.1, 12.1, 12.2, 12.4,
 *               13.1, 13.2, 13.3, 14.2, 14.3, 15.2, 15.3, 17.2, 17.3, 17.4
 */

import { For, Show, createEffect, createMemo, createSignal, onMount, type JSX } from "solid-js"
import { join } from "node:path"
import type { TuiPluginApi, TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { KeyEvent } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"

import type {
  AgentChoice,
  BranchSpec,
  DimensionSpec,
  RawConfigBlock,
  ResourceDraft,
  StepDraft,
  StepField,
  StepKind,
  WizardAction,
  WizardState,
  WizardStep,
  DraftStructure,
} from "../types"
import {
  buildConfigRows,
  firstInvalidStep,
  reduce,
  stepSummaries,
  toAnswers,
  toConfigBlock,
  validateStep,
  type ConfigRow,
} from "./create-state"
import { renderScript } from "./scaffold"
import { renderConfigJson } from "../config/config-writer"
import { renderDraftJson } from "../config/draft-store"

/** 全屏路由名（唯一）。供 tui.tsx 注册 route 与 useKeyboard 守卫使用。 */
export const STUDIO_ROUTE = "workflow-studio"

/**
 * 旧路由名常量，等价于 {@link STUDIO_ROUTE}。
 *
 * 命令收敛后 `/workflows-create` 更名 `/workflows-studio`，路由随之更名 `workflow-studio`；
 * 保留本别名以兼容既有引用与集成测试（它们以符号引用而非字面量比较）。
 */
export const CREATE_ROUTE = STUDIO_ROUTE

// AgentChoice 在 types.ts 定义，向外 re-export 便于 tui.tsx（Task 11）注入 listAgents 时引用。
export type { AgentChoice } from "../types"

type Theme = TuiThemeCurrent

/** 底栏脚本预览展示的最大行数（R3.1：前若干行）。窄/中屏（无右预览栏）时用。 */
const PREVIEW_LINES = 12

/** 双栏并排所需的最小终端宽度；不足则窄屏退化单栏 + 顶部步骤条（R6.9）。 */
const MIN_TWO_COLUMN_WIDTH = 84

/**
 * 三栏（导航 | 编辑 | 右侧常驻实时脚本预览）所需的最小终端宽度。
 * ≥ 此宽度时右栏显示完整脚本预览（可滚动）、并隐藏底部预览条；否则退化为双栏 + 底部预览条。
 */
const MIN_THREE_COLUMN_WIDTH = 100

/** 右侧实时脚本预览栏宽度（三栏布局下）。 */
const PREVIEW_PANE_WIDTH = 42

/** 左栏宽度。 */
const LEFT_WIDTH = 30

/**
 * 步骤「执行 Agent」选择开关（M2 批次2：开放 build/explore）。
 *
 * M2: 向用户开放 build/explore 两个 agent 选项（不再拉取完整 /agent 列表）。
 * - build: 通用构建 agent，可读写文件
 * - explore: 只读代码探索 agent，renderScript 自动套用 READ-ONLY 5段模板
 *
 * 置为 `true` 恢复选择器，但限定候选为 ALLOWED_AGENTS（不使用 /agent 端点）。
 */
const AGENT_SELECTION_ENABLED = true

/** M2: 允许的 agent 候选（限定为 build/explore）。 */
const ALLOWED_AGENTS = ["build", "explore"]

/** 选择器关闭时展示且唯一可选的默认执行 Agent 名（等价于 agentType 未设置时的运行时回退）。 */
const DEFAULT_AGENT_LABEL = "build"

/**
 * create-screen 的注入式 props（I/O 端口 + 数据源）。
 *
 * 真实实现由 tui.tsx（Task 11）注入：`writeUserWorkflow`/`writeUserConfig` 为原子写端口，
 * `listAgents` 为 `/agent` 列举（已过滤 subagent/all + 静态 ask 扫描，端点不可用降级 []），
 * `loadExistingConfig`/`builtinDefaults` 为编辑入口回填数据源（R13）。
 */
export interface CreateScreenProps {
  api: TuiPluginApi
  /** 已注册名集合（内置 + 全局自定义），validateName 与 subflow 选项用。 */
  registeredNames: () => ReadonlySet<string>
  /** 列举可选 Agent（仅 subagent/all）；端点不可用/错误时 reject 或返回 []（降级，R14.5/R14.6）。 */
  listAgents: () => Promise<AgentChoice[]>
  /** 落盘脚本（复用 writeUserWorkflowToGlobalDir）。返回绝对路径。 */
  writeUserWorkflow: (fileName: string, content: string) => Promise<string>
  /** 落盘配置（新增 writeUserConfigToGlobalDir，同语义）。返回绝对路径。 */
  writeUserConfig: (fileName: string, content: string) => Promise<string>
  /** 读取某 workflow 现有配置用于回填（编辑入口）；缺失返回 null。 */
  loadExistingConfig?: (name: string) => Promise<RawConfigBlock | null>
  /** 内置 default-* 的默认配置提供者（首次编辑种子化回填用，R13.2）。 */
  builtinDefaults?: (name: string) => RawConfigBlock | null
  /** 可选编辑入口：传入则进入「编辑已有 wf 配置」模式（R13）。 */
  editName?: string
  /**
   * 编辑配置模式下该 workflow 的声明阶段名（来自脚本 `meta.phases`，AST 静态提取）。
   *
   * 编辑配置模式（mode="edit"）直接跳到 config 步、不走 phases 步，故 answers.phases 原本为空，
   * 导致脚本预览回退 ["Main"]、配置区按阶段分组用错阶段名（与脚本真实阶段不一致）。传入此项后，
   * initState 用它种子化 answers.phases，使配置区/脚本预览/阶段选择器都用脚本真实阶段名。
   * 与 {@link editName} 配套使用；create / edit-structure 模式不用（结构由用户输入 / draft 回填）。
   */
  editPhases?: string[]
  /**
   * 可选「编辑结构」入口（方案 C）：传入则进入 `edit-structure` 模式——完整 7 步，
   * 回填 `<name>.draft.json` 的结构（phases/steps/args 等）+ `<name>.config.json` 的配置，
   * name 只读，SUBMIT 时重写 `.mjs` + `.config.json` + `.draft.json` 三文件。
   * 与 {@link editName} 互斥（编辑结构优先）。
   */
  editStructureName?: string
  /** 读取某 workflow 现有结构草稿（`<name>.draft.json`）用于回填；缺失/损坏返回 null（方案 C）。 */
  loadDraft?: (name: string) => Promise<DraftStructure | null>
  /**
   * 全局目录绝对路径（tui.tsx 传 `resolveGlobalDir()`），配置来源行显示**完整文件路径**用。
   * 缺省时来源行回退 `~/.opencode-workflows/` 形式（可读性略降，功能不受影响）。
   */
  globalDir?: string
  /** Esc 安全返回来源路由。 */
  onClose: () => void
}

/** route 注册入口（保持 tui.tsx JSX-free）。 */
export function renderCreateRoute(props: CreateScreenProps): JSX.Element {
  return <CreateScreen {...props} />
}

/**
 * 只读占位渲染（装配失败 / 渲染异常兜底）。
 *
 * 供 tui.tsx 在「装配失败」或 route render 抛错时注册，**绝不黑屏**（R1.6）。
 * 保持 tui.tsx JSX-free：占位 JSX 封装在本组件内，入口只调用此导出函数。
 */
export function renderCreatePlaceholder(api: TuiPluginApi, message: string): JSX.Element {
  return <CreatePlaceholder api={api} message={message} />
}

/** 只读占位组件：展示不可用原因 + Esc 返回提示（不持有任何业务状态）。 */
function CreatePlaceholder(props: { api: TuiPluginApi; message: string }): JSX.Element {
  const dim = useTerminalDimensions()
  const theme = (): Theme => props.api.theme.current
  useKeyboard((evt: KeyEvent) => {
    if (props.api.route.current.name !== CREATE_ROUTE) return
    try {
      if (evt.name === "escape") {
        evt.preventDefault()
        evt.stopPropagation()
        props.api.route.navigate("home")
      }
    } catch {
      // 占位界面按键回调绝不向上抛（Issue #13461）。
    }
  }, {})
  return (
    <box
      width={dim().width}
      height={dim().height}
      backgroundColor={theme().background}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={theme().accent}>创建 Workflow（暂不可用）</text>
      <text fg={theme().textMuted}>{props.message}</text>
      <text fg={theme().textMuted}>按 Esc 返回。</text>
    </box>
  )
}

// ============================================================================
// 常量与小工具
// ============================================================================

/** 创建流可见主步骤顺序（左栏总览 + 步骤条）。资源绑定(config)前置于 steps（见 create-state.ts）。 */
const VISIBLE_CREATE: WizardStep[] = ["name", "desc", "phases", "config", "steps", "args", "confirm"]

/** 编辑流可见主步骤顺序（仅配置/确认两步，R13.1）。 */
const VISIBLE_EDIT: WizardStep[] = ["config", "confirm"]

/**
 * 步骤子表单中以 `<input>` 编辑的文本/数值字段（焦点时键盘交给输入框）。
 *
 * 质量模式新增字段：threshold/convergenceRounds（数值，与 fanout/maxRounds 同款）、synthesis（文本）。
 * 注意 perspectives 不在此集合——它是字符串列表，经列表型多值控件编辑（与 branches/dimensions 同类）。
 */
export const STEP_TEXT_FIELDS = new Set<StepField>([
  "label",
  "intent",
  "subflowName",
  "fanout",
  "maxRounds",
  "threshold",
  "convergenceRounds",
  "synthesis",
])

/**
 * 资源类别子表单可编辑字段顺序（改动 A：移除 `phase`）。
 *
 * 归属阶段不再在子表单内选择——它由「阶段分组树」的上下文自动决定（在某阶段的类别行/新增行
 * 触发编辑时，RES_ADD{phase} 已把归属阶段填入草稿），故子表单只剩三个文本字段，录入更省事。
 * - `category`/`paths`/`label`：`<input>` 文本字段。
 */
const RES_FIELDS = ["category", "paths", "label"] as const
type ResField = (typeof RES_FIELDS)[number]

/**
 * 可选编排模式（步骤 kind 选择器）。
 *
 * 向导现暴露 7 种 StepKind：`single` / `branches` / `gate` / `subflow` 四种基础模式，外加三种
 * 质量模式 `adversarial`（对抗验证）/ `finder-loop`（挖到挖干）/ `judge-panel`（评审团）。
 * `parallel`（同质扇出）与 `pipeline`（无屏障批处理）在脚手架里只能生成固定占位形态、真实编排
 * 表达力弱，故仍从向导**隐藏**（不在新建步骤时可选）；但 `scaffold.ts` 的 `renderStep` 仍保留
 * 对二者的 `case`，历史脚本/草稿若用到仍可正常渲染与运行（代码不删，留待后续扩展）。
 *
 * 注：内部 `StepKind` 字符串保持不变（`branches` 仍是 `"branches"`），仅在 UI 上经
 * {@link kindLabel} 把 `branches` 显示为「parallel（并行/多路）」——对用户更直观，且其生成
 * 产物本就是 `ctx.parallel([...])`，名副其实。零数据迁移、不影响渲染层与既有测试。
 */
export const STEP_KINDS: StepKind[] = [
  "single",
  "branches",
  "gate",
  "subflow",
  "adversarial",
  "finder-loop",
  "judge-panel",
]

/**
 * 步骤 kind 的向导**显示名**（仅展示用；不改变内部 `StepKind` 字符串与渲染逻辑）。
 *
 * - `branches` → 显示「parallel」：异构并发多路，结果合并为命名 section（用户心智里的「并行」）。
 * - `adversarial` / `finder-loop` / `judge-panel`：三种质量模式，配中文友好显示名。
 * - `parallel` / `pipeline`：已从选择器隐藏；保留可读标注以兼容历史步骤的展示（正常不会出现）。
 */
export const STEP_KIND_LABEL: Record<StepKind, string> = {
  single: "single",
  branches: "parallel",
  gate: "gate",
  subflow: "subflow",
  adversarial: "adversarial（对抗验证）",
  "finder-loop": "finder-loop（挖到挖干）",
  "judge-panel": "judge-panel（评审团）",
  parallel: "parallel (legacy·同质扇出)",
  pipeline: "pipeline (legacy)",
}

/** 取步骤 kind 的向导显示名；未知 kind 原样回退。 */
function kindLabel(kind: StepKind): string {
  return STEP_KIND_LABEL[kind] ?? kind
}

/** 中文步骤标题（与 create-state 的 STEP_TITLES 同义，本组件渲染用）。 */
const STEP_TITLES: Record<WizardStep, string> = {
  name: "名称",
  desc: "描述",
  phases: "阶段",
  config: "资源绑定",
  steps: "步骤",
  args: "参数",
  confirm: "确认生成",
}

/** 把图标语义映射为字符。 */
function iconChar(icon: "done" | "current" | "todo"): string {
  return icon === "done" ? "✔" : icon === "current" ? "▶" : " "
}

/** 把异常转可读消息。 */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 把下标钳制到 [0, len-1]（len 为 0 时返回 0）。 */
function clampIndex(i: number, len: number): number {
  if (len <= 0) return 0
  if (i < 0) return 0
  if (i >= len) return len - 1
  return i
}

/**
 * 数字字段（fanout / maxRounds / threshold / convergenceRounds）的输入校验提示。
 * 空串返回 ""（合法，使用默认值）。
 *
 * - fanout：要求 [2,16] 内整数；maxRounds：要求 [1,10] 内整数（与 renderScript 钳制及字段标签一致）。
 * - threshold / convergenceRounds：质量模式数值字段，语义上 >=1，但向导只做「非负整数」校验
 *   （含 0 合法、不设上界），具体下界/上界由渲染层默认值兜底与钳制处理。
 *
 * 不合法时返回中文提示文案（供 UI 以 warning 色展示）。
 */
export function numericFieldWarning(
  field: "fanout" | "maxRounds" | "threshold" | "convergenceRounds",
  value: string,
): string {
  const v = value.trim()
  if (v.length === 0) return "" // 空 = 使用默认值，合法。
  const n = Number(v)
  // threshold / convergenceRounds：非负整数即可（含 0、不设上界）。
  if (field === "threshold" || field === "convergenceRounds") {
    if (!Number.isInteger(n) || n < 0) return "请输入非负整数"
    return ""
  }
  const min = field === "fanout" ? 2 : 1
  const max = field === "fanout" ? 16 : 10
  if (!Number.isInteger(n)) return `请输入 ${min}-${max} 之间的整数`
  if (n < min || n > max) return `请输入 ${min}-${max} 之间的整数（当前 ${v} 越界）`
  return ""
}

/** 构造向导初始状态（创建 / 编辑配置 / 编辑结构）。 */
function initState(props: CreateScreenProps): WizardState {
  const editingStructure = typeof props.editStructureName === "string" && props.editStructureName.length > 0
  const editingConfig = !editingStructure && typeof props.editName === "string" && props.editName.length > 0
  const mode: WizardState["mode"] = editingStructure ? "edit-structure" : editingConfig ? "edit" : "create"
  const seedName = editingStructure
    ? (props.editStructureName as string)
    : editingConfig
      ? (props.editName as string)
      : ""
  return {
    mode,
    // edit（仅配置）从 config 步起；edit-structure 与 create 同从 name 步起（name 只读）。
    mainStep: editingConfig ? "config" : "name",
    answers: {
      name: seedName,
      description: "",
      // 编辑配置模式种子化脚本真实阶段（editPhases，来自 meta.phases）；create/edit-structure 为空
      // （前者用户输入、后者由 LOAD_DRAFT 回填）。使配置区分组/脚本预览/阶段选择器与脚本阶段一致。
      phases: editingConfig && Array.isArray(props.editPhases) ? props.editPhases.slice() : [],
      steps: [],
      resources: {},
      resourceLabels: {},
      outputPath: undefined,
      args: [],
    },
    config: { resources: {}, resourceLabels: {}, outputPath: {}, maxReviewRounds: {} },
    registeredNames: props.registeredNames(),
    agentOptions: [],
    agentEndpointAvailable: true,
    stepEditor: { kind: "list" },
    phaseEditor: { kind: "list" },
    resourceEditor: { kind: "list" },
    stepError: null,
    focus: "list",
    finished: false,
  }
}

// ============================================================================
// 主组件
// ============================================================================

/**
 * Workflow 创建/编辑全屏向导组件。
 *
 * 渲染「左栏总览 + 右栏分步编辑 + 底栏脚本预览 + 状态栏」，键盘经 `useKeyboard` 映射为
 * `WizardAction`。所有副作用（写盘、列举 Agent、回填配置）经注入 props，回调一律 try/catch。
 */
export function CreateScreen(props: CreateScreenProps): JSX.Element {
  const dim = useTerminalDimensions()
  const theme = (): Theme => props.api.theme.current

  // ── 向导单一状态源 ──
  const [state, setState] = createSignal<WizardState>(initState(props))

  // ── 屏幕局部交互状态（非业务规则，不入归约器）──
  const [region, setRegion] = createSignal<"left" | "right">(props.editName ? "right" : "left")
  const [stepCursor, setStepCursor] = createSignal(0) // 左栏选中步骤行
  const [listCursor, setListCursor] = createSignal(0) // phases/steps 列表行
  const [configCursor, setConfigCursor] = createSignal(0) // config 步行（资源 + 添加 + 落盘）
  /**
   * 配置来源（P2 修复的可见性配套）：编辑入口回填时判定数据来自哪个层级，配置步头部展示。
   * - "file"：命中 `~/.opencode-workflows/<name>.config.json`（用户上次保存的，编辑它）；
   * - "builtin"：未落盘过，表单展示的是引擎内置默认（defaultScriptDefaults 种子）；
   * - "none"：新建模式 / 自定义 workflow 无内置默认（空表单）。
   * 关键语义提示：builtin 态保存后即落盘单文件、**屏蔽内置默认**（文件级短路优先级）——
   * 因此 builtin 态的来源行附「保存后以本文件为准」警示。
   */
  const [configSource, setConfigSource] = createSignal<"file" | "builtin" | "none">("none")

  /**
   * 该 workflow 是否「内置且内置默认无落盘」（如 default-code：代码由子 Agent 直接写仓库，
   * 脚本读了 outputPath 但从不使用）——其落盘路径行显示「不支持配置」文案且不进编辑。
   * 判定：内置种子存在且其 output_path 字典为空。自定义 workflow（无种子）一律正常配置
   * （脚手架生成的脚本消费 outputPath）。
   */
  const builtinNoOutput = createMemo<boolean>(() => {
    const name = props.editName
    if (!name) return false
    const seed = props.builtinDefaults?.(name) ?? null
    if (!seed) return false
    return !(seed.output_path && typeof seed.output_path === "object" && Object.keys(seed.output_path).length > 0)
  })
  // 改动 A：config 步阶段分组树的「已折叠阶段名」集合（不在集合内 = 展开）。默认全部展开。
  // 折叠态只影响展示与导航（buildConfigRows），不进归约器（非业务规则）。
  const [collapsedPhases, setCollapsedPhases] = createSignal<ReadonlySet<string>>(new Set<string>())
  const [fieldCursor, setFieldCursor] = createSignal(0) // 步骤编辑字段游标
  const [resFieldCursor, setResFieldCursor] = createSignal(0) // 资源编辑字段游标
  // 资源子表单是否处于「字段编辑」态（true=某字段输入框聚焦；false=字段导航态，无聚焦输入）。
  // 两态模型：导航态用 ↑/↓ 切字段（宿主下聚焦 input 会吞掉 ↑/↓，故导航态必须无聚焦输入）；
  // Enter 进入编辑态 / 在「保存」行提交；编辑态 Enter 提交并跳下一字段、Esc 退回导航态。
  const [resEditing, setResEditing] = createSignal(false)
  const [useConfigCursor, setUseConfigCursor] = createSignal(0) // 参考资源多选子游标
  const [useStepsCursor, setUseStepsCursor] = createSignal(0) // 引用上游步多选子游标（A2-full）
  const [scrollOffset, setScrollOffset] = createSignal(0) // 确认页脚本滚动
  const [previewScroll, setPreviewScroll] = createSignal(0) // 右侧常驻预览栏滚动（三栏布局，PgUp/PgDn）
  // intent（agent prompt）多行编辑模式：true 时 textarea 聚焦，↑/↓/Enter 归 textarea，Esc 离开（方案 C UI）。
  const [intentEditing, setIntentEditing] = createSignal(false)
  // 步骤简单文本字段（label/subflowName/fanout/maxRounds）编辑态：true=聚焦输入框。
  // 与资源编辑器同理——宿主下聚焦 input 吞 ↑/↓/Enter，故导航态必须无聚焦输入（↑/↓ 才能切字段），
  // 录入收敛到编辑态（Enter 进入、Enter onSubmit / Esc 退回）。
  const [stepTextEditing, setStepTextEditing] = createSignal(false)
  // intent textarea 渲染句柄：onContentChange 事件不带文本，须经 ref.plainText 读取内容回写草稿。
  let intentTextareaRef: { plainText?: string } | undefined
  // 分支/维度子项 intent 多行编辑模式 + 句柄（与主步骤 intent 同模型）。
  const [subIntentEditing, setSubIntentEditing] = createSignal(false)
  let subIntentTextareaRef: { plainText?: string } | undefined
  const [submitting, setSubmitting] = createSignal(false)

  // phases 内联编辑（reducer 的 PHASE_ADD/PHASE_EDIT 携值、无 OPEN 动作，故编辑态置于屏幕本地）。
  const [phaseEdit, setPhaseEdit] = createSignal<{ index: number } | null>(null)
  const [phaseDraft, setPhaseDraft] = createSignal("")

  // ──────────────────────────────────────────────────────────────────────────
  // 文本字段本地草稿（关键修复：受控 <input> 必须读「本地信号」而非 state()）。
  //
  // 背景：opentui 的 <input> 在 value 受外部改变时会 setText + 把 cursorOffset 复位到末尾，
  // 而 SolidJS 渲染层在 state() 变化时会重建右栏子树。若 onInput 直接 dispatch→setState，
  // 每敲一个字符都会触发右栏重渲染 + value 受控回灌，导致光标错乱（"需求分析"→"需析分求"）、
  // Backspace/Delete 删错字符、方向键无效。可正常输入的 phases 之所以没问题，正是因为它读的是
  // 本地 phaseDraft() 信号、onInput 只 setPhaseDraft、不碰 state。
  //
  // 解法：name/desc/args/output_path 以及步骤/资源子表单的全部文本字段都改为「本地草稿信号驱动 +
  // onInput 只写本地信号」，仅在导航（NEXT/BACK/Tab 切焦/GOTO/打开-关闭子编辑器）与提交时把草稿
  // commit 进归约器。归约器契约与属性测试保持不变。
  // ──────────────────────────────────────────────────────────────────────────
  const [nameDraft, setNameDraft] = createSignal(state().answers.name)
  const [descDraft, setDescDraft] = createSignal(state().answers.description)
  const [argsDraft, setArgsDraft] = createSignal(state().answers.args.join(", "))
  // output_path / max_review_rounds 的「当前编辑阶段」（per-phase）。配置区内有一行专门的
  // 「落盘/轮次配置阶段」选择行，光标停在该行时用 ←/→ 在已声明阶段间循环切换；切换时先把当前
  // 草稿提交到旧阶段，再从新阶段回填草稿（见 switchOutPhase）。空 phases 回退 "Main"。
  const initOutPhase = state().answers.phases[0] || "Main"
  const [outPhaseDraft, setOutPhaseDraft] = createSignal(initOutPhase)
  const [outputDraft, setOutputDraft] = createSignal(state().config.outputPath[initOutPhase] || "")
  const [mrrDraft, setMrrDraft] = createSignal(state().config.maxReviewRounds[initOutPhase] || "")
  // config 列表的 output_path / max_review_rounds 两态：导航态（无聚焦输入，↑/↓ 可切行）vs 编辑态
  // （聚焦输入框录入）。与资源/步骤编辑器同理——宿主 opentui 下聚焦 <input> 会吞掉 ↑/↓/Enter，
  // 故必须在导航态保持无聚焦输入，否则光标会被首个输入框（output_path）困住、无法下移到 max_review_rounds。
  const [configEditing, setConfigEditing] = createSignal(false)

  // 步骤编辑子表单文本字段草稿（label/intent/subflowName/fanout/maxRounds）。
  const [stepLabelDraft, setStepLabelDraft] = createSignal("")
  const [stepIntentDraft, setStepIntentDraft] = createSignal("")
  const [stepSubflowDraft, setStepSubflowDraft] = createSignal("")
  const [stepFanoutDraft, setStepFanoutDraft] = createSignal("")
  const [stepMaxRoundsDraft, setStepMaxRoundsDraft] = createSignal("")

  // 资源编辑子表单文本字段草稿（category/paths/label）。
  const [resCategoryDraft, setResCategoryDraft] = createSignal("")
  const [resPathsDraft, setResPathsDraft] = createSignal("")
  const [resLabelDraft, setResLabelDraft] = createSignal("")
  // 资源归属阶段草稿（选择型，←/→ 在已声明阶段间循环）。
  const [resPhaseDraft, setResPhaseDraft] = createSignal("")

  // ──────────────────────────────────────────────────────────────────────────
  // 分支/维度子编辑界面局部交互状态（任务 3.2）。
  //
  // 步骤子表单聚焦到 branches/dimensions 字段后 Enter 进入「列表子编辑模式」（subMode="list"），
  // 其中 a 添加 / d 删除 / Enter 进项编辑 / Shift+↑↓ 调序 / Esc 退回字段列表；
  // 进项编辑后（subMode="item"）以本地草稿信号驱动文本字段，切项/提交时 commit（B1/B2）。
  // 所有数据变更经 BRANCH_*/DIM_* action 分派给 reduce，stepEditor.draft 为唯一真相（R9.3/R9.4）。
  // ──────────────────────────────────────────────────────────────────────────
  type SubMode = "none" | "list" | "item"
  const [subMode, setSubMode] = createSignal<SubMode>("none")
  const [subCursor, setSubCursor] = createSignal(0) // 分支/维度列表行游标
  const [subFieldCursor, setSubFieldCursor] = createSignal(0) // 项内字段游标
  const [subPrimaryDraft, setSubPrimaryDraft] = createSignal("") // 分支 label / 维度 name 文本草稿
  const [subIntentDraft, setSubIntentDraft] = createSignal("") // 项 intent 文本草稿

  /** 把 name/desc/args/output 文本草稿合并写回归约器（导航/提交前调用）。 */
  function commitTextDrafts(): void {
    const st = state()
    if (nameDraft() !== st.answers.name) dispatch({ type: "SET_NAME", value: nameDraft() })
    if (descDraft() !== st.answers.description) dispatch({ type: "SET_DESC", value: descDraft() })
    if (argsDraft() !== st.answers.args.join(", ")) dispatch({ type: "SET_ARGS", value: argsDraft() })
    // output_path / max_review_rounds 提交到「当前编辑阶段」（per-phase）。
    const outPhase = outPhaseDraft() || st.answers.phases[0] || "Main"
    const currentOutputPath = st.config.outputPath[outPhase] || ""
    const currentMRR = st.config.maxReviewRounds[outPhase] || ""
    if (outputDraft() !== currentOutputPath) {
      dispatch({ type: "SET_OUTPUT_PHASE", phase: outPhase, value: outputDraft() })
    }
    if (mrrDraft() !== currentMRR) {
      dispatch({ type: "SET_MAX_REVIEW_ROUNDS_PHASE", phase: outPhase, value: mrrDraft() })
    }
  }

  /**
   * 切换 output_path / max_review_rounds 的「当前编辑阶段」：先把当前草稿提交到旧阶段（避免丢失
   * 用户输入），再把 outPhaseDraft 指向新阶段并从 state 回填该阶段的草稿值。
   */
  function switchOutPhase(dir: 1 | -1): void {
    commitTextDrafts()
    const st = state()
    const phases = st.answers.phases.length > 0 ? st.answers.phases : ["Main"]
    const cur = outPhaseDraft() || phases[0]
    const nv = cycle(phases, cur, dir)
    setOutPhaseDraft(nv)
    setOutputDraft(st.config.outputPath[nv] || "")
    setMrrDraft(st.config.maxReviewRounds[nv] || "")
  }

  /** 用某步骤草稿初始化步骤子表单的文本草稿信号（打开编辑器时调用）。 */
  function seedStepDrafts(draft: StepDraft): void {
    setStepLabelDraft(draft.label ?? "")
    setStepIntentDraft(draft.intent ?? "")
    setStepSubflowDraft(draft.subflowName ?? "")
    setStepFanoutDraft(draft.fanout != null ? String(draft.fanout) : "")
    setStepMaxRoundsDraft(draft.maxRounds != null ? String(draft.maxRounds) : "")
  }

  /** 把步骤子表单文本草稿写回 stepEditor.draft（切字段/提交前调用）。 */
  function commitStepDrafts(): void {
    const st = state()
    if (st.stepEditor.kind !== "edit") return
    const d = st.stepEditor.draft
    if (stepLabelDraft() !== (d.label ?? "")) dispatch({ type: "STEP_SET_FIELD", field: "label", value: stepLabelDraft() })
    if (stepIntentDraft() !== (d.intent ?? "")) dispatch({ type: "STEP_SET_FIELD", field: "intent", value: stepIntentDraft() })
    if (stepSubflowDraft() !== (d.subflowName ?? "")) {
      dispatch({ type: "STEP_SET_FIELD", field: "subflowName", value: stepSubflowDraft() })
    }
    const fanoutNum = stepFanoutDraft().trim().length === 0 ? undefined : Number.parseInt(stepFanoutDraft(), 10)
    if ((fanoutNum ?? undefined) !== (d.fanout ?? undefined)) {
      dispatch({ type: "STEP_SET_FIELD", field: "fanout", value: Number.isFinite(fanoutNum as number) ? fanoutNum : undefined })
    }
    const maxRoundsNum = stepMaxRoundsDraft().trim().length === 0 ? undefined : Number.parseInt(stepMaxRoundsDraft(), 10)
    if ((maxRoundsNum ?? undefined) !== (d.maxRounds ?? undefined)) {
      dispatch({
        type: "STEP_SET_FIELD",
        field: "maxRounds",
        value: Number.isFinite(maxRoundsNum as number) ? maxRoundsNum : undefined,
      })
    }
  }

  /** 用某资源草稿初始化资源子表单的文本草稿信号（打开编辑器时调用）。 */
  function seedResDrafts(draft: ResourceDraft): void {
    setResPhaseDraft(draft.phase ?? "")
    setResCategoryDraft(draft.category ?? "")
    setResPathsDraft((draft.paths ?? []).join(", "))
    setResLabelDraft(draft.label ?? "")
  }

  /** 把资源子表单文本草稿写回 resourceEditor.draft（切字段/提交前调用）。 */
  function commitResDrafts(): void {
    const st = state()
    if (st.resourceEditor.kind !== "edit") return
    const d = st.resourceEditor.draft
    if (resPhaseDraft() !== (d.phase ?? "")) {
      dispatch({ type: "RES_SET_FIELD", field: "phase", value: resPhaseDraft() })
    }
    if (resCategoryDraft() !== (d.category ?? "")) {
      dispatch({ type: "RES_SET_FIELD", field: "category", value: resCategoryDraft() })
    }
    if (resLabelDraft() !== (d.label ?? "")) dispatch({ type: "RES_SET_FIELD", field: "label", value: resLabelDraft() })
    const paths = resPathsDraft()
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (paths.join("\u0000") !== (d.paths ?? []).join("\u0000")) {
      dispatch({ type: "RES_SET_FIELD", field: "paths", value: paths })
    }
  }

  // ── 派生 ──
  const visibleSteps = createMemo<WizardStep[]>(() => (state().mode === "edit" ? VISIBLE_EDIT : VISIBLE_CREATE))
  const summaries = createMemo(() => stepSummaries(state()))
  const summaryOf = (step: WizardStep) => summaries().find((s) => s.step === step)

  /** 统计所有阶段的资源类别总数（辅助函数，解决 resources 从数组变为嵌套字典后的计数问题）。 */
  function countTotalResourceCategories(resources: Record<string, Record<string, string[]>>): number {
    let count = 0
    for (const categories of Object.values(resources)) {
      if (categories && typeof categories === "object") {
        count += Object.keys(categories).length
      }
    }
    return count
  }

  const declaredCategories = createMemo<string[]>(() => {
    const cats = new Set<string>()
    for (const categories of Object.values(state().config.resources)) {
      if (categories && typeof categories === "object") {
        for (const cat of Object.keys(categories)) {
          cats.add(cat)
        }
      }
    }
    return Array.from(cats)
  })

  /**
   * 当前编辑步「可引用的更早步」列表（A2-full）：仅取编辑索引之前、且已有稳定 id 的步骤，
   * 供「引用上游步」多选控件展示与勾选。无更早步则为空（控件显示占位）。
   */
  const earlierSteps = createMemo<Array<{ id: string; label: string }>>(() => {
    const st = state()
    if (st.stepEditor.kind !== "edit") return []
    const idx = st.stepEditor.index
    const out: Array<{ id: string; label: string }> = []
    for (let i = 0; i < Math.min(idx, st.answers.steps.length); i++) {
      const s = st.answers.steps[i]
      if (typeof s.id === "string" && s.id.length > 0) {
        out.push({ id: s.id, label: s.label && s.label.length > 0 ? s.label : `步骤${i + 1}` })
      }
    }
    return out
  })

  /**
   * 改动 A：config 步阶段分组树的扁平行模型（渲染与键盘导航共用单一真相）。
   * 由 buildConfigRows 据 state + 折叠集合纯函数生成；折叠态变化即自动重算。
   */
  const configRows = createMemo<ConfigRow[]>(() => buildConfigRows(state(), collapsedPhases()))

  /** 合并本地文本草稿到 answers（底栏预览随填随更新，且不触发右栏输入框重建）。 */
  const liveAnswers = () => {
    const base = toAnswers(state())
    const op = outputDraft()
    return {
      ...base,
      name: nameDraft(),
      description: descDraft(),
      args: argsDraft()
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      outputPath: op && op.length > 0 ? op : base.outputPath,
    }
  }

  /** 底栏脚本预览前若干行（包 try/catch，错误→占位不抛，R3.4）。 */
  const previewLines = createMemo<string[]>(() => {
    try {
      return renderScript(liveAnswers()).split("\n").slice(0, PREVIEW_LINES)
    } catch {
      return ["（脚本预览暂不可用：草稿数据待补全）"]
    }
  })

  /** 确认页完整脚本（包 try/catch，R3.4）。 */
  const fullScript = createMemo<string[]>(() => {
    try {
      return renderScript(liveAnswers()).split("\n")
    } catch (err) {
      return [`（脚本生成失败：${errMsg(err)}）`]
    }
  })

  /** 选中 Agent 含 ask 规则时的常驻警告（R15.2，不阻止选择 R15.3）。 */
  const askWarning = createMemo<string | null>(() => {
    const st = state()
    if (st.stepEditor.kind !== "edit") return null
    const at = st.stepEditor.draft.agentType
    if (!at) return null
    const a = st.agentOptions.find((o) => o.name === at)
    return a && a.hasAskRule
      ? "⚠ 该 Agent 含 ask 权限规则：后台运行会挂起至 agentTimeout(默认 300s)超时失败，建议更换 Agent 或在其定义中改为 allow。"
      : null
  })

  // ── 副作用辅助（一律 try/catch，绝不上抛 — Issue #13461 / R17.4）──

  function dispatch(action: WizardAction): void {
    try {
      setState((prev) => reduce(prev, action))
    } catch {
      // 归约器理论上纯且不抛；防御性兜底，绝不让按键回调崩溃。
    }
  }

  function toast(message: string, variant: "info" | "success" | "warning" | "error"): void {
    try {
      props.api.ui.toast({ message, variant })
    } catch {
      // toast 失败静默。
    }
  }

  function safeClose(): void {
    try {
      props.onClose()
    } catch {
      // 关闭回调失败静默。
    }
  }

  /** 列举可选 Agent（仅 subagent/all）；端点不可用/错误降级空、忽略缓存（R14.5/R14.6）。 */
  async function refreshAgents(): Promise<void> {
    try {
      const opts = await props.listAgents()
      dispatch({ type: "SET_AGENT_OPTIONS", options: opts, available: opts.length > 0 })
    } catch {
      dispatch({ type: "SET_AGENT_OPTIONS", options: [], available: false })
    }
  }

  /** 编辑模式回填：loadExistingConfig 优先，缺失回退 builtinDefaults（R13.2/R13.3）。 */
  async function loadForEdit(): Promise<void> {
    const name = props.editName
    if (!name) return
    try {
      let block: RawConfigBlock | null = null
      if (props.loadExistingConfig) block = await props.loadExistingConfig(name)
      if (block) {
        setConfigSource("file")
      } else if (props.builtinDefaults && (block = props.builtinDefaults(name))) {
        setConfigSource("builtin")
      }
      if (block) {
        // declaredPhases：脚本声明阶段（editPhases，来自 meta.phases）。传入后 LOAD_CONFIG 会把
        // 历史错配的孤儿阶段自愈合并到声明阶段（方案 A），消除 code/Main 等遗留错位键。
        const declaredPhases = Array.isArray(props.editPhases) ? props.editPhases : undefined
        dispatch({ type: "LOAD_CONFIG", block, ...(declaredPhases ? { declaredPhases } : {}) })
        // 回填仅一次性 seed output 草稿（避免持续 effect 在后续 commit 时把用户输入拉回，B4）。
        // 默认编辑首个阶段；用户可在配置区用「落盘/轮次配置阶段」行 ←/→ 切换到其他阶段。
        const seedPhase = state().answers.phases[0] || "Main"
        setOutPhaseDraft(seedPhase)
        setOutputDraft(state().config.outputPath[seedPhase] || "")
        setMrrDraft(state().config.maxReviewRounds[seedPhase] || "")
      }
    } catch (err) {
      toast(`加载配置失败：${errMsg(err)}`, "error")
    }
  }

  /**
   * 结构编辑回填（方案 C）：先回填结构草稿（draft.json），再回填配置（config.json）。
   *
   * 两个数据源各自独立：结构（phases/steps/args/desc）来自 `<name>.draft.json`，资源/落盘
   * 来自 `<name>.config.json`（用户可能单独经 Studio「改配置」改过配置）。回填后一次性 seed
   * name/desc/args/output 本地草稿信号，避免受控 input 与归约器脱节（与 B4 同源）。
   */
  async function loadForEditStructure(): Promise<void> {
    const name = props.editStructureName
    if (!name) return
    try {
      // 1) 结构草稿回填。
      if (props.loadDraft) {
        const structure = await props.loadDraft(name)
        if (structure) dispatch({ type: "LOAD_DRAFT", structure })
      }
      // 2) 配置回填（与 loadForEdit 同源）。
      let block: RawConfigBlock | null = null
      if (props.loadExistingConfig) block = await props.loadExistingConfig(name)
      if (block) {
        setConfigSource("file")
      } else if (props.builtinDefaults && (block = props.builtinDefaults(name))) {
        setConfigSource("builtin")
      }
      if (block) dispatch({ type: "LOAD_CONFIG", block })
      // 3) 一次性 seed 本地文本草稿信号（结构 + 配置回填后）。
      const a = state().answers
      setNameDraft(a.name)
      setDescDraft(a.description)
      setArgsDraft(a.args.join(", "))
      // 默认编辑首个阶段；用户可在配置区用「落盘/轮次配置阶段」行 ←/→ 切换到其他阶段。
      const seedPhase = a.phases[0] || "Main"
      setOutPhaseDraft(seedPhase)
      setOutputDraft(state().config.outputPath[seedPhase] || "")
      setMrrDraft(state().config.maxReviewRounds[seedPhase] || "")
    } catch (err) {
      toast(`加载结构失败：${errMsg(err)}`, "error")
    }
  }

  onMount(() => {
    void refreshAgents()
    if (state().mode === "edit") void loadForEdit()
    else if (state().mode === "edit-structure") void loadForEditStructure()
  })

  // ── 列表项「声明了但未填路径」的类别（落盘写占位 none，R12.3）──
  function declaredButEmpty(st: WizardState): string[] {
    const emptyCategories: string[] = []
    for (const [_phase, categories] of Object.entries(st.config.resources)) {
      for (const [category, paths] of Object.entries(categories)) {
        if (paths.every((p: string) => !p || p.trim().length === 0 || p.trim() === "none")) {
          emptyCategories.push(category)
        }
      }
    }
    return emptyCategories
  }

  /** 是否存在未保存草稿（Esc 二次确认依据，R6.7）。 */
  function hasDraft(): boolean {
    const st = state()
    const a = st.answers
    const hasResources = countTotalResourceCategories(st.config.resources) > 0
    const hasOutputPath = Object.values(st.config.outputPath).some((p) => p && p.length > 0)
    const hasMRR = Object.values(st.config.maxReviewRounds).some((m) => m && m.length > 0)
    return !!(
      a.name ||
      nameDraft() ||
      a.description ||
      descDraft() ||
      a.phases.length ||
      a.steps.length ||
      a.args.length ||
      argsDraft() ||
      hasResources ||
      hasOutputPath ||
      outputDraft() ||
      hasMRR ||
      mrrDraft()
    )
  }

  /** Esc：有草稿弹二次确认，确认后不落盘安全返回；无草稿直接返回（R6.7/R17.6）。 */
  function requestClose(): void {
    if (!hasDraft()) {
      safeClose()
      return
    }
    try {
      props.api.ui.dialog.replace(() =>
        props.api.ui.DialogConfirm({
          title: "放弃并返回？",
          message: "存在未保存的草稿。确认放弃？（不会写入任何文件）",
          onConfirm: () => {
            try {
              props.api.ui.dialog.clear()
            } catch {
              /* ignore */
            }
            safeClose()
          },
          onCancel: () => {
            try {
              props.api.ui.dialog.clear()
            } catch {
              /* ignore */
            }
          },
        }),
      )
    } catch {
      // 弹框失败：直接安全返回，绝不抛。
      safeClose()
    }
  }

  /** 跳转到某步并复位右栏交互游标。 */
  function gotoStep(step: WizardStep): void {
    commitTextDrafts()
    dispatch({ type: "GOTO", step })
    setRegion("right")
    resetListCursors()
  }

  /** 复位右栏各列表游标（NEXT/BACK/GOTO 进入新步时调用，避免带着上一步行号，C2）。 */
  function resetListCursors(): void {
    setListCursor(0)
    setConfigCursor(0)
    setScrollOffset(0)
    setConfigEditing(false)
  }

  /** 前进一步：commit 文本草稿 → NEXT（校验门控）→ 仅在确实换步时复位列表游标。 */
  function goNext(): void {
    commitTextDrafts()
    const before = state().mainStep
    dispatch({ type: "NEXT" })
    if (state().mainStep !== before) resetListCursors()
  }

  /** 后退一步：commit 文本草稿 → BACK → 仅在确实换步时复位列表游标。 */
  function goBack(): void {
    commitTextDrafts()
    const before = state().mainStep
    dispatch({ type: "BACK" })
    if (state().mainStep !== before) resetListCursors()
  }

  /** SUBMIT 双落盘流程（R12.2/R12.4/R17.2/R17.3/R17.4；编辑模式仅写配置 R13.4）。 */
  async function doSubmit(): Promise<void> {
    if (submitting()) return
    // 提交前把所有本地文本草稿（含正在编辑的子表单）合并回归约器，确保落盘数据完整。
    commitTextDrafts()
    commitStepDrafts()
    commitResDrafts()
    const st = state()
    if (st.mode === "edit") {
      const v = validateStep({ ...st, mainStep: "config" })
      if (!v.ok) {
        gotoStep("config")
        toast(v.reason, "warning")
        return
      }
    } else {
      const bad = firstInvalidStep(st)
      if (bad) {
        gotoStep(bad)
        const v = validateStep({ ...st, mainStep: bad })
        toast(v.ok ? "请完善必填项后再生成" : v.reason, "warning")
        return
      }
    }
    setSubmitting(true)
    try {
      const block = toConfigBlock(st)
      const json = renderConfigJson(block, { declaredButEmpty: declaredButEmpty(st) })
      const cfgFile = `${st.answers.name}.config.json`
      if (st.mode === "edit") {
        const cfgPath = await props.writeUserConfig(cfgFile, json)
        toast(`已保存配置：${cfgPath}`, "success")
        dispatch({ type: "SUBMIT" })
        safeClose()
        return
      }
      // 创建 / 编辑结构模式：脚本 + 配置 + 结构草稿三文件各自原子写。
      // 任一失败 → 停确认页 toast 原因可重试（R12.4/R17.3）。draft sidecar 供「再次编辑结构」回填（方案 C）。
      const answers = toAnswers(st)
      const script = renderScript(answers)
      const draftJson = renderDraftJson(answers)
      const scriptPath = await props.writeUserWorkflow(`${st.answers.name}.mjs`, script)
      const cfgPath = await props.writeUserConfig(cfgFile, json)
      await props.writeUserConfig(`${st.answers.name}.draft.json`, draftJson)
      toast(
        st.mode === "edit-structure"
          ? `已更新：${scriptPath}（含配置与结构草稿）`
          : `已生成：${scriptPath}  与  ${cfgPath}`,
        "success",
      )
      dispatch({ type: "SUBMIT" })
      safeClose()
    } catch (err) {
      toast(`落盘失败：${errMsg(err)}（停留在确认页，可重试）`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  // ── 键盘映射（首行守卫非本路由不响应，R6.10；整体 try/catch 绝不上抛 R17.4）──
  useKeyboard((evt: KeyEvent) => {
    if (props.api.route.current.name !== CREATE_ROUTE) return
    try {
      onKey(evt)
    } catch {
      // 按键回调绝不向上抛（Issue #13461：TUI hook 抛异常致黑屏）。
    }
  }, {})

  function onKey(evt: KeyEvent): void {
    const name = evt.name
    const ctrl = evt.ctrl === true
    const stop = () => {
      evt.preventDefault()
      evt.stopPropagation()
    }
    const st = state()

    // Ctrl+S：聚合校验 → 生成落盘，否则跳首个非法步（R6.6）。任意位置可触发。
    if (ctrl && name === "s") {
      stop()
      void doSubmit()
      return
    }

    // PgUp/PgDn：滚动右侧常驻实时预览栏（仅三栏宽度有此栏；只读、不抢焦点，任意位置可触发）。
    if (wide() && (name === "pageup" || name === "pagedown")) {
      stop()
      const total = Math.max(1, fullScript().length)
      const step = Math.max(1, Math.floor((dim().height - 8) / 2))
      setPreviewScroll((o) => clampIndex(name === "pageup" ? o - step : o + step, total))
      return
    }

    // Esc：渐进式「逐级退出」（替代原 Tab 回左栏 + Esc 关闭，避免与宿主 Tab/agent_cycle 冲突）。
    // 层级：已打开的子编辑器 → 取消回列表；右栏（无子编辑器）→ 回左栏总览；左栏 → 二次确认关闭。
    if (name === "escape") {
      stop()
      if (phaseEdit() !== null) {
        setPhaseEdit(null)
        return
      }
      // intent 多行编辑：Esc 先离开 textarea（提交草稿），回到字段导航（方案 C UI）。
      if (st.stepEditor.kind === "edit" && intentEditing()) {
        // 兜底：直接从 textarea 句柄读取最新内容（onContentChange 不带文本）。
        if (intentTextareaRef && typeof intentTextareaRef.plainText === "string") {
          setStepIntentDraft(intentTextareaRef.plainText)
        }
        commitStepDrafts()
        setIntentEditing(false)
        return
      }
      if (st.stepEditor.kind === "edit" && subMode() !== "none") {
        // 子项 intent 多行编辑：Esc 先离开 textarea（读 ref.plainText 提交草稿），回项内字段。
        if (subMode() === "item" && subIntentEditing()) {
          if (subIntentTextareaRef && typeof subIntentTextareaRef.plainText === "string") {
            setSubIntentDraft(subIntentTextareaRef.plainText)
          }
          setSubIntentEditing(false)
          return
        }
        // 分支/维度子编辑：逐级退出（item → 提交回 list；list → 退回字段列表）。
        if (subMode() === "item") {
          commitSubItem()
          setSubMode("list")
        } else {
          setSubMode("none")
        }
        return
      }
      if (st.stepEditor.kind === "edit") {
        // 简单文本字段编辑态 Esc：提交并退回字段导航（不取消整个步骤）。
        if (stepTextEditing()) {
          commitStepDrafts()
          setStepTextEditing(false)
          return
        }
        setSubMode("none")
        dispatch({ type: "STEP_CANCEL" })
        return
      }
      if (st.resourceEditor.kind === "edit") {
        // 编辑态 Esc：退回导航态（保留已输入值）；导航态 Esc：取消整个资源类别编辑。
        if (resEditing()) {
          commitResDrafts()
          setResEditing(false)
          return
        }
        dispatch({ type: "RES_CANCEL" })
        return
      }
      // config 列表的 output_path / max_review_rounds 编辑态 Esc：提交并退回导航态（不离开右栏）。
      if (st.mainStep === "config" && configEditing()) {
        commitTextDrafts()
        setConfigEditing(false)
        return
      }
      // 右栏 → 回左栏总览（先提交文本草稿，等价旧 Tab 回左栏的语义）。
      if (region() === "right") {
        commitTextDrafts()
        setRegion("left")
        return
      }
      // 左栏 → 二次确认返回（R6.7）。
      requestClose()
      return
    }

    // 子编辑器优先于主导航。
    if (phaseEdit() !== null) return onPhaseEditorKey(evt, stop)
    if (st.stepEditor.kind === "edit") return onStepEditorKey(evt, stop)
    if (st.resourceEditor.kind === "edit") return onResEditorKey(evt, stop)

    // 左栏焦点：步骤总览导航（R6.1/R6.2）。
    if (region() === "left") return onLeftKey(evt, stop)

    // 右栏焦点：按步骤类型分派。
    switch (st.mainStep) {
      case "name":
      case "desc":
      case "args":
        return onTextStepKey(evt, stop)
      case "phases":
        return onPhaseListKey(evt, stop)
      case "steps":
        return onStepListKey(evt, stop)
      case "config":
        return onConfigListKey(evt, stop)
      case "confirm":
        return onConfirmKey(evt, stop)
      default:
        return
    }
  }

  // ── 左栏（步骤总览）──
  function onLeftKey(evt: KeyEvent, stop: () => void): void {
    const steps = visibleSteps()
    switch (evt.name) {
      case "up":
        stop()
        setStepCursor((i) => clampIndex(i - 1, steps.length))
        break
      case "down":
        stop()
        setStepCursor((i) => clampIndex(i + 1, steps.length))
        break
      case "left":
        stop()
        goBack()
        break
      case "right":
        stop()
        goNext()
        break
      case "return":
        stop()
        gotoStep(steps[clampIndex(stepCursor(), steps.length)])
        break
      case "tab":
        stop()
        setRegion("right")
        break
      default:
        break
    }
  }

  // ── 文本步（name/desc/args）：输入框焦点，仅 Enter/Tab/← 拦截（R6.3 + A2/A3 修复）──
  function onTextStepKey(evt: KeyEvent, stop: () => void): void {
    if (evt.name === "return") {
      stop()
      goNext()
      return
    }
    if (evt.name === "tab") {
      stop()
      commitTextDrafts()
      setRegion("left")
      return
    }
    // A2/A3 修复：← 后退到上一步（与左栏 ←、提示文案一致）。不拦截 → 前进（← 已在提示中，
    // 但 → 在文本步不提及，避免用户依赖它——单行输入框内 → 应用于光标移动，不抢占为导航）。
    if (evt.name === "left") {
      stop()
      goBack()
      return
    }
    // 其余键（字符/Backspace/↑/↓/→）不拦截，交给 <input>。
  }

  // ── phases 列表 ──
  function onPhaseListKey(evt: KeyEvent, stop: () => void): void {
    const phases = state().answers.phases
    const addRow = phases.length // 末行为「+ 添加阶段」
    const shift = evt.shift === true
    switch (evt.name) {
      case "up":
        stop()
        if (shift && listCursor() < phases.length && listCursor() > 0) {
          dispatch({ type: "PHASE_MOVE", index: listCursor(), dir: -1 })
          setListCursor((i) => i - 1)
        } else setListCursor((i) => clampIndex(i - 1, addRow + 1))
        break
      case "down":
        stop()
        if (shift && listCursor() < phases.length - 1) {
          dispatch({ type: "PHASE_MOVE", index: listCursor(), dir: 1 })
          setListCursor((i) => i + 1)
        } else setListCursor((i) => clampIndex(i + 1, addRow + 1))
        break
      case "a":
        stop()
        setPhaseDraft("")
        setPhaseEdit({ index: phases.length })
        break
      case "d":
        stop()
        if (listCursor() < phases.length) dispatch({ type: "PHASE_DELETE", index: listCursor() })
        break
      case "return":
        stop()
        if (listCursor() < phases.length) {
          setPhaseDraft(phases[listCursor()])
          setPhaseEdit({ index: listCursor() })
        } else {
          setPhaseDraft("")
          setPhaseEdit({ index: phases.length })
        }
        break
      case "right":
        stop()
        goNext()
        break
      case "tab":
        stop()
        setRegion("left")
        break
      default:
        break
    }
  }

  /** 提交 phases 内联编辑（新增/编辑阶段标题）。供键盘 Enter 与 <input> onSubmit 共用。 */
  function commitPhase(): void {
    const value = phaseDraft().trim()
    const edit = phaseEdit()
    if (edit && value.length > 0) {
      if (edit.index >= state().answers.phases.length) dispatch({ type: "PHASE_ADD", value })
      else dispatch({ type: "PHASE_EDIT", index: edit.index, value })
    }
    setPhaseEdit(null)
  }

  // ── phases 内联输入编辑（Enter 提交、Tab 提交并停留；其余交给 <input>）──
  function onPhaseEditorKey(evt: KeyEvent, stop: () => void): void {
    if (evt.name === "return" || evt.name === "tab") {
      stop()
      commitPhase()
      return
    }
    // 其余交给 <input>。
  }

  // ── steps 列表 ──
  function onStepListKey(evt: KeyEvent, stop: () => void): void {
    const steps = state().answers.steps
    const addRow = steps.length
    const shift = evt.shift === true
    switch (evt.name) {
      case "up":
        stop()
        if (shift && listCursor() < steps.length && listCursor() > 0) {
          dispatch({ type: "STEP_MOVE", index: listCursor(), dir: -1 })
          setListCursor((i) => i - 1)
        } else setListCursor((i) => clampIndex(i - 1, addRow + 1))
        break
      case "down":
        stop()
        if (shift && listCursor() < steps.length - 1) {
          dispatch({ type: "STEP_MOVE", index: listCursor(), dir: 1 })
          setListCursor((i) => i + 1)
        } else setListCursor((i) => clampIndex(i + 1, addRow + 1))
        break
      case "a":
        stop()
        openStepEditor(steps.length)
        break
      case "d":
        stop()
        if (listCursor() < steps.length) dispatch({ type: "STEP_DELETE", index: listCursor() })
        break
      case "return":
        stop()
        if (listCursor() < steps.length) openStepEditor(listCursor())
        else openStepEditor(steps.length)
        break
      case "right":
        stop()
        goNext()
        break
      case "tab":
        stop()
        setRegion("left")
        break
      default:
        break
    }
  }

  /** 打开步骤编辑子表单（新增 index=length / 编辑既有），并刷新可选 Agent（R14.6）。 */
  function openStepEditor(index: number): void {
    const steps = state().answers.steps
    if (index >= steps.length) dispatch({ type: "STEP_ADD" })
    else dispatch({ type: "STEP_EDIT", index })
    setFieldCursor(0)
    setUseConfigCursor(0)
    setUseStepsCursor(0)
    setSubMode("none")
    setIntentEditing(false)
    setStepTextEditing(false)
    setSubIntentEditing(false)
    setSubCursor(0)
    setSubFieldCursor(0)
    const ed = state().stepEditor
    if (ed.kind === "edit") seedStepDrafts(ed.draft)
    void refreshAgents()
  }

  /** 步骤编辑子表单当前 kind 下的可见字段。 */
  function stepFieldsForKind(kind: StepKind): StepField[] {
    const base: StepField[] = ["phase", "kind", "label", "intent"]
    if (kind === "subflow") base.push("subflowName")
    base.push("useConfig", "agentType")
    // useSteps（引用上游步）紧随 agentType：可选高级字段、默认空。置于 kind 专属字段之前，
    // 既不改动 single 的 useConfig/agentType 游标位置，又保持 branches/dimensions 仍为末尾字段
    // （子编辑器经「↓到底再↑一次」定位的契约不破）。
    base.push("useSteps")
    if (kind === "parallel" || kind === "pipeline") base.push("fanout")
    if (kind === "gate") base.push("maxRounds", "dimensions")
    if (kind === "branches") base.push("branches")
    return base
  }

  // ── 步骤编辑子表单键盘（两态：导航 ↑/↓ 切字段；简单文本字段 Enter 进编辑 / 末尾「保存」行提交）──
  function onStepEditorKey(evt: KeyEvent, stop: () => void): void {
    const st = state()
    if (st.stepEditor.kind !== "edit") return
    const draft = st.stepEditor.draft
    const fields = stepFieldsForKind(draft.kind)
    const SAVE_INDEX = fields.length // 末尾虚拟「保存步骤」行
    const idx = clampIndex(fieldCursor(), fields.length + 1)
    const onSave = idx === SAVE_INDEX
    const field = onSave ? undefined : fields[idx]

    // 分支/维度列表子编辑模式优先于字段导航（R9.3）。
    if (subMode() === "list") return onSubListKey(evt, stop)
    if (subMode() === "item") return onSubItemKey(evt, stop)

    // intent 多行编辑中：不拦截任何键（↑/↓/Enter/字符全归 textarea）；离开经 Esc（顶层 onKey）。
    if (intentEditing()) return
    // 简单文本字段编辑中：输入框聚焦、独占按键（Enter 由 onSubmit 提交、Esc 顶层处理退回导航）。
    if (stepTextEditing()) return

    // 导航态切字段：↑/↓（Tab 兼容别名）。此时无聚焦输入框，方向键可靠。含末尾「保存」行。
    // 钳制（不回绕）：到顶/底停住，便于「↑ 到顶 / ↓ 到底（保存行）」的确定性导航。
    if (evt.name === "up" || evt.name === "down" || evt.name === "tab") {
      stop()
      const dir = evt.name === "up" || (evt.name === "tab" && evt.shift === true) ? -1 : 1
      setFieldCursor((i) => clampIndex(clampIndex(i, fields.length + 1) + dir, fields.length + 1))
      return
    }
    if (evt.name === "return") {
      stop()
      // 「保存」行 Enter → 提交步骤。
      if (onSave) {
        commitStepDrafts()
        dispatch({ type: "STEP_COMMIT" })
        return
      }
      // branches/dimensions 字段 Enter → 进入列表子编辑模式（R9.1/R9.2）。
      if (field === "branches" || field === "dimensions") {
        commitStepDrafts()
        setSubCursor(0)
        setSubMode("list")
        return
      }
      // intent 字段 Enter → 进入多行编辑（textarea）。
      if (field === "intent") {
        setIntentEditing(true)
        return
      }
      // 简单文本字段（label/subflowName/fanout/maxRounds）Enter → 进入字段编辑（挂载聚焦输入框）。
      if (field && STEP_TEXT_FIELDS.has(field)) {
        setStepTextEditing(true)
        return
      }
      // phase/kind/agentType/useConfig：Enter 无操作（用 ←/→ 选值、Space 勾选；保存走「保存」行）。
      return
    }

    // 选择型字段：←/→ 改值（space 用于 useConfig 切换）。改值前先 commit 文本草稿，保持单一真相（B1）。
    const isText = field ? STEP_TEXT_FIELDS.has(field) : false
    if (!isText) {
      if (field === "phase") {
        if (evt.name === "left" || evt.name === "right") {
          stop()
          commitStepDrafts()
          const phases = state().answers.phases.length > 0 ? state().answers.phases : ["Main"]
          const nv = cycle(phases, draft.phase, evt.name === "right" ? 1 : -1)
          dispatch({ type: "STEP_SET_FIELD", field: "phase", value: nv })
        }
      } else if (field === "kind") {
        if (evt.name === "left" || evt.name === "right") {
          stop()
          commitStepDrafts()
          const nv = cycle(STEP_KINDS, draft.kind, evt.name === "right" ? 1 : -1)
          dispatch({ type: "STEP_SET_FIELD", field: "kind", value: nv })
          // kind 改变会增减可见字段集合：把游标退回到 kind 字段、并按新草稿 reseed 文本草稿，
          // 避免 fieldCursor 越界跳动与陈旧文本草稿残留（B2）。
          const ed = state().stepEditor
          if (ed.kind === "edit") {
            const newFields = stepFieldsForKind(ed.draft.kind)
            const kindIdx = newFields.indexOf("kind")
            setFieldCursor(kindIdx >= 0 ? kindIdx : 0)
            setIntentEditing(false)
            seedStepDrafts(ed.draft)
          }
        }
      } else if (field === "agentType") {
        if (evt.name === "left" || evt.name === "right") {
          stop()
          commitStepDrafts()
          // M2: 候选限定为 build/explore 两项（"(默认)"与 build 运行时等价，合并只显示两项）。
          // 选 build → agentType=undefined（运行时回退 build，脚本干净）；选 explore → "explore"。
          const opts = AGENT_SELECTION_ENABLED ? ALLOWED_AGENTS : ["build"]
          const cur = draft.agentType === "explore" ? "explore" : "build"
          const nv = cycle(opts, cur, evt.name === "right" ? 1 : -1)
          dispatch({ type: "STEP_SET_AGENT", agentType: nv === "explore" ? "explore" : undefined })
        }
      } else if (field === "useConfig") {
        const cats = declaredCategories()
        if (evt.name === "left") {
          stop()
          setUseConfigCursor((i) => clampIndex(i - 1, cats.length))
        } else if (evt.name === "right") {
          stop()
          setUseConfigCursor((i) => clampIndex(i + 1, cats.length))
        } else if (evt.name === "space") {
          stop()
          commitStepDrafts()
          const cat = cats[clampIndex(useConfigCursor(), cats.length)]
          if (cat) {
            const cur = state().stepEditor
            if (cur.kind === "edit") {
              dispatch({ type: "STEP_SET_FIELD", field: "useConfig", value: toggleUseConfig(cur.draft.useConfig, cat) })
            }
          }
        }
      } else if (field === "useSteps") {
        // 引用上游步多选（A2-full）：←/→ 移动子游标，Space 勾选/取消勾选当前更早步。
        const refs = earlierSteps()
        if (evt.name === "left") {
          stop()
          setUseStepsCursor((i) => clampIndex(i - 1, refs.length))
        } else if (evt.name === "right") {
          stop()
          setUseStepsCursor((i) => clampIndex(i + 1, refs.length))
        } else if (evt.name === "space") {
          stop()
          commitStepDrafts()
          const ref = refs[clampIndex(useStepsCursor(), refs.length)]
          if (ref) {
            const cur = state().stepEditor
            if (cur.kind === "edit") {
              dispatch({ type: "STEP_SET_FIELD", field: "useSteps", value: toggleStepRef(cur.draft.useSteps ?? [], ref.id) })
            }
          }
        }
      }
      return
    }
    // 文本字段：其余键交给 <input>（onInput 经 STEP_SET_FIELD 回写）。
  }

  // ── 分支/维度子编辑：当前激活的列表类别（由步骤 kind 决定，唯一不歧义）──
  type SubKind = "branch" | "dim"
  function activeSubKind(): SubKind | null {
    const st = state()
    if (st.stepEditor.kind !== "edit") return null
    const k = st.stepEditor.draft.kind
    if (k === "branches") return "branch"
    if (k === "gate") return "dim"
    return null
  }

  /** 当前激活子列表（分支或维度）。 */
  function activeSubList(): (BranchSpec | DimensionSpec)[] {
    const st = state()
    if (st.stepEditor.kind !== "edit") return []
    const sk = activeSubKind()
    if (sk === "branch") return st.stepEditor.draft.branches ?? []
    if (sk === "dim") return st.stepEditor.draft.dimensions ?? []
    return []
  }

  /** 用列表某项初始化项内文本草稿（进项编辑时调用，B1/B2）。 */
  function seedSubItem(index: number): void {
    const sk = activeSubKind()
    const list = activeSubList()
    const item = list[index]
    if (!item) {
      setSubPrimaryDraft("")
      setSubIntentDraft("")
      return
    }
    if (sk === "branch") setSubPrimaryDraft((item as BranchSpec).label ?? "")
    else setSubPrimaryDraft((item as DimensionSpec).name ?? "")
    setSubIntentDraft(item.intent ?? "")
  }

  /** 把项内文本草稿写回 stepEditor.draft（切项/提交时 commit，规避受控 input 光标错乱，B2）。 */
  function commitSubItem(): void {
    const sk = activeSubKind()
    const idx = subCursor()
    const list = activeSubList()
    if (idx < 0 || idx >= list.length) return
    if (sk === "branch") {
      const cur = list[idx] as BranchSpec
      if (subPrimaryDraft() !== (cur.label ?? "")) {
        dispatch({ type: "BRANCH_SET_FIELD", index: idx, field: "label", value: subPrimaryDraft() })
      }
      if (subIntentDraft() !== (cur.intent ?? "")) {
        dispatch({ type: "BRANCH_SET_FIELD", index: idx, field: "intent", value: subIntentDraft() })
      }
    } else if (sk === "dim") {
      const cur = list[idx] as DimensionSpec
      if (subPrimaryDraft() !== (cur.name ?? "")) {
        dispatch({ type: "DIM_SET_FIELD", index: idx, field: "name", value: subPrimaryDraft() })
      }
      if (subIntentDraft() !== (cur.intent ?? "")) {
        dispatch({ type: "DIM_SET_FIELD", index: idx, field: "intent", value: subIntentDraft() })
      }
    }
  }

  // ── 分支/维度列表子编辑模式键盘（a 添加 / d 删除 / Enter 进项编辑 / Shift+↑↓ 调序）──
  function onSubListKey(evt: KeyEvent, stop: () => void): void {
    const sk = activeSubKind()
    if (sk === null) return
    const list = activeSubList()
    const shift = evt.shift === true
    switch (evt.name) {
      case "up":
        stop()
        if (shift && subCursor() < list.length && subCursor() > 0) {
          dispatch({ type: sk === "branch" ? "BRANCH_MOVE" : "DIM_MOVE", index: subCursor(), dir: -1 })
          setSubCursor((i) => i - 1)
        } else setSubCursor((i) => clampIndex(i - 1, list.length))
        break
      case "down":
        stop()
        if (shift && subCursor() < list.length - 1) {
          dispatch({ type: sk === "branch" ? "BRANCH_MOVE" : "DIM_MOVE", index: subCursor(), dir: 1 })
          setSubCursor((i) => i + 1)
        } else setSubCursor((i) => clampIndex(i + 1, list.length))
        break
      case "a":
        stop()
        dispatch({ type: sk === "branch" ? "BRANCH_ADD" : "DIM_ADD" })
        setSubCursor(activeSubList().length - 1)
        break
      case "d":
        stop()
        if (subCursor() < list.length) {
          dispatch({ type: sk === "branch" ? "BRANCH_DELETE" : "DIM_DELETE", index: subCursor() })
          setSubCursor((i) => clampIndex(i, activeSubList().length))
        }
        break
      case "return":
        stop()
        if (subCursor() < list.length) {
          setSubFieldCursor(0)
          setSubIntentEditing(false)
          seedSubItem(subCursor())
          setSubMode("item")
        }
        break
      default:
        break
    }
  }

  /** 项内字段（primary=label/name、intent）顺序。 */
  const SUB_ITEM_FIELDS = ["primary", "intent"] as const

  // ── 分支/维度项内字段编辑键盘（↑/↓ 切字段；intent 多行 textarea 进入/离开；切项/提交 commit）──
  function onSubItemKey(evt: KeyEvent, stop: () => void): void {
    // intent 多行编辑中：不拦截任何键（↑/↓/Enter/字符全交给 textarea），离开经 Esc（顶层处理）。
    if (subIntentEditing()) return
    if (evt.name === "up" || evt.name === "down" || evt.name === "tab") {
      stop()
      commitSubItem()
      const dir = evt.name === "up" || (evt.name === "tab" && evt.shift === true) ? -1 : 1
      setSubFieldCursor((i) => (i + dir + SUB_ITEM_FIELDS.length) % SUB_ITEM_FIELDS.length)
      return
    }
    if (evt.name === "return") {
      stop()
      // 聚焦 intent（field 1）时 Enter 进入多行编辑；否则提交回 list。
      if (subFieldCursor() === 1) {
        setSubIntentEditing(true)
        return
      }
      commitSubItem()
      setSubMode("list")
      return
    }
    // 其余键交给 <input>（本地草稿信号驱动）。
  }

  // ── config 列表（资源类别 + 添加行 + 落盘路径 / 最大审查轮次两输入行）──
  // output_path 与 max_review_rounds 为两态行：导航态（无聚焦输入，↑/↓ 可切行；Enter 进入编辑）、
  // 编辑态（聚焦输入框，Enter/Tab 或 onSubmit 提交回导航，Esc 顶层退回导航）。
  function onConfigListKey(evt: KeyEvent, stop: () => void): void {
    const rows = configRows()
    const c = clampIndex(configCursor(), rows.length)
    const row = rows[c]
    const shift = evt.shift === true

    // 编辑态（output/mrr 输入聚焦）：宿主下 input.onSubmit 提交；harness 下全局收到 Enter/Tab 走此分支。
    if (configEditing()) {
      if (evt.name === "return" || evt.name === "tab") {
        stop()
        commitTextDrafts()
        setConfigEditing(false)
      }
      return
    }

    if (evt.name === "tab") {
      stop()
      commitTextDrafts()
      setRegion("left")
      return
    }

    // ↑/↓ 在分组树行间移动（钳制不回绕）。Shift+↑/↓ 仅在「同阶段相邻资源行」间调序（RES_MOVE）。
    if (evt.name === "up") {
      stop()
      commitTextDrafts()
      const prev = rows[c - 1]
      if (shift && row?.kind === "resource" && prev?.kind === "resource" && prev.phase === row.phase && row.globalIndex >= 0) {
        dispatch({ type: "RES_MOVE", index: row.globalIndex, dir: -1 })
      }
      setConfigCursor(clampIndex(c - 1, rows.length))
      return
    }
    if (evt.name === "down") {
      stop()
      commitTextDrafts()
      const next = rows[c + 1]
      if (shift && row?.kind === "resource" && next?.kind === "resource" && next.phase === row.phase && row.globalIndex >= 0) {
        dispatch({ type: "RES_MOVE", index: row.globalIndex, dir: 1 })
      }
      setConfigCursor(clampIndex(c + 1, rows.length))
      return
    }

    if (!row) return

    // 阶段标题行：Enter 折叠/展开该阶段；a 在该阶段新增类别；→ 前进下一步。
    if (row.kind === "phase-header") {
      if (evt.name === "return") {
        stop()
        togglePhaseCollapse(row.phase)
      } else if (evt.name === "a") {
        stop()
        openResAdd(row.phase)
      } else if (evt.name === "right") {
        stop()
        goNext()
      }
      return
    }

    // 「新增类别」行（展开阶段内）：Enter/a 在该阶段新增类别；→ 前进。
    if (row.kind === "add-category") {
      if (evt.name === "return" || evt.name === "a") {
        stop()
        openResAdd(row.phase)
      } else if (evt.name === "right") {
        stop()
        goNext()
      }
      return
    }

    // 资源类别行：Enter 编辑（归属阶段已定，子表单不再选阶段）；a 在同阶段新增；d 删除；→ 前进。
    if (row.kind === "resource") {
      switch (evt.name) {
        case "return":
          stop()
          if (row.globalIndex >= 0) openResEditor(row.globalIndex)
          break
        case "a":
          stop()
          openResAdd(row.phase)
          break
        case "d":
          stop()
          if (row.globalIndex >= 0) dispatch({ type: "RES_DELETE", index: row.globalIndex })
          break
        case "right":
          stop()
          goNext()
          break
        default:
          break
      }
      return
    }

    // 落盘/轮次配置阶段选择行：←/→ 在已声明阶段间循环切换（与 output/mrr 的 per-phase 录入配套）。
    if (row.kind === "out-phase") {
      if (evt.name === "left") {
        stop()
        switchOutPhase(-1)
      } else if (evt.name === "right") {
        stop()
        switchOutPhase(1)
      }
      return
    }

    // output_path / max_review_rounds 行（导航态）：Enter 进入编辑（聚焦输入）；→ 前进下一步。
    if (row.kind === "output-path" || row.kind === "max-review-rounds") {
      // 不支持配置的落盘行（内置默认无落盘的 workflow，如 default-code）：Enter 不进编辑
      //（显示「不支持配置」文案，编辑了也无效——脚本读 outputPath 但从不使用）。
      if (row.kind === "output-path" && builtinNoOutput()) return
      if (evt.name === "return") {
        stop()
        setConfigEditing(true)
      } else if (evt.name === "right") {
        stop()
        goNext()
      }
      return
    }
  }

  /** 折叠/展开某阶段（改动 A：阶段分组树）。 */
  function togglePhaseCollapse(phase: string): void {
    setCollapsedPhases((prev) => {
      const next = new Set(prev)
      if (next.has(phase)) next.delete(phase)
      else next.add(phase)
      return next
    })
  }

  /**
   * 在指定阶段新增资源类别（改动 A）：RES_ADD 携 phase 把归属阶段填入草稿，
   * 子表单因此无需再选阶段；同时确保该阶段展开（新类别提交后立即可见）。
   */
  function openResAdd(phase: string): void {
    dispatch({ type: "RES_ADD", phase })
    setResFieldCursor(0)
    setResEditing(false) // 进入即导航态（无聚焦输入），↑/↓ 可靠切字段。
    const ed = state().resourceEditor
    if (ed.kind === "edit") seedResDrafts(ed.draft)
    setCollapsedPhases((prev) => {
      if (!prev.has(phase)) return prev
      const next = new Set(prev)
      next.delete(phase)
      return next
    })
  }

  function openResEditor(index: number): void {
    const resources = state().config.resources
    const resCount = countTotalResourceCategories(resources)
    if (index >= resCount) dispatch({ type: "RES_ADD" })
    else dispatch({ type: "RES_EDIT", index })
    setResFieldCursor(0)
    setResEditing(false) // 进入即导航态（无聚焦输入），↑/↓ 可靠切字段。
    const ed = state().resourceEditor
    if (ed.kind === "edit") seedResDrafts(ed.draft)
  }

  /** 资源编辑态「提交当前字段并前进」（末字段→落到保存行退出编辑）。供键盘 Enter 与 onSubmit 共用。 */
  function resEditAdvance(): void {
    commitResDrafts()
    const next = resFieldCursor() + 1
    if (next < RES_FIELDS.length) {
      setResFieldCursor(next) // 跳下一字段，继续编辑（连续录入）。
    } else {
      setResFieldCursor(RES_FIELDS.length) // 末字段提交 → 落到「保存」行，退回导航态。
      setResEditing(false)
    }
  }

  // ── 资源类别编辑子表单（两态：导航 ↑/↓ 切字段 · Enter 编辑/保存；编辑 Enter 下一字段 · Esc 退回）──
  //
  // 为何两态：宿主 opentui 下，聚焦的单行 <input> 会吞掉 ↑/↓ 与 Enter（全局 useKeyboard 抢不到），
  // 故「导航态」必须保证无聚焦输入——此时 ↑/↓ 与列表导航同源、可靠切字段（含末尾「保存」行），
  // Enter 经全局 onResEditorKey 进入编辑 / 提交。「编辑态」聚焦输入框，Enter 由 <input> 的
  // onSubmit（{@link resEditAdvance}）提交并前进；字符/编辑键交给输入框；Esc 退回导航（主分支处理）。
  function onResEditorKey(evt: KeyEvent, stop: () => void): void {
    if (state().resourceEditor.kind !== "edit") return
    const SAVE_INDEX = RES_FIELDS.length // 类别名(0)/路径(1)/引导语(2) + 保存(3)

    // 编辑态：Enter 由 input.onSubmit 提交并前进（宿主下全局收不到 Enter）；harness 下走此分支。
    if (resEditing()) {
      if (evt.name === "return" || evt.name === "tab") {
        stop()
        resEditAdvance()
        return
      }
      return // 字符 / ←/→ / Backspace → 输入框
    }

    // 导航态：↑/↓ 在 [类别名, 路径, 引导语, 保存] 间移动（改动 A：归属阶段已由上下文决定，不在此选）。钳制不回绕。
    if (evt.name === "up" || evt.name === "down") {
      stop()
      const dir = evt.name === "up" ? -1 : 1
      setResFieldCursor((i) => clampIndex(i + dir, RES_FIELDS.length + 1))
      return
    }
    if (evt.name === "return") {
      stop()
      if (resFieldCursor() >= SAVE_INDEX) {
        commitResDrafts()
        dispatch({ type: "RES_COMMIT" })
      } else {
        // 内置 workflow 的引导语字段不支持编辑（脚本不读取，编辑不生效——渲染层显示说明文案）。
        const field = RES_FIELDS[resFieldCursor()]
        const isBuiltinWf = !!(props.editName && props.builtinDefaults?.(props.editName))
        if (field === "label" && isBuiltinWf) return
        setResEditing(true) // 进入当前文本字段编辑（挂载聚焦输入框）。
      }
      return
    }
  }

  // ── 确认页 ──
  function onConfirmKey(evt: KeyEvent, stop: () => void): void {
    switch (evt.name) {
      case "up":
      case "k":
        stop()
        setScrollOffset((o) => Math.max(0, o - 1))
        break
      case "down":
      case "j":
        stop()
        setScrollOffset((o) => Math.min(Math.max(0, fullScript().length - 1), o + 1))
        break
      case "return":
        stop()
        void doSubmit()
        break
      case "left":
        stop()
        goBack()
        break
      case "tab":
        stop()
        setRegion("left")
        break
      default:
        break
    }
  }

  // ── 渲染 ──
  const narrow = createMemo(() => dim().width < MIN_TWO_COLUMN_WIDTH)
  /** 是否启用三栏（右侧常驻实时脚本预览栏）。窄屏永远关闭。 */
  const wide = createMemo(() => !narrow() && dim().width >= MIN_THREE_COLUMN_WIDTH)

  // C3 修复：窄屏（单栏，左栏不渲染）下强制 region="right"。否则若 region 停在 "left"，
  // 左栏不可见但键盘仍在操作不可见的左栏游标，用户看不到任何反馈而困惑。窄屏下唯一可见的是
  // 右栏（当前步），故把焦点钉在右栏；终端变宽回到双栏后用户可正常 Esc 回左栏。
  createEffect(() => {
    if (narrow() && region() === "left") setRegion("right")
  })
  /** 分隔线跟随内容宽度（④：与内容右界对齐，不再硬截 78）。 */
  const dividerLine = (): string => "─".repeat(Math.max(10, dim().width - 2))

  return (
    <box
      width={dim().width}
      height={dim().height}
      backgroundColor={theme().background}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
    >
      {/* 标题栏 */}
      <text fg={theme().accent}>
        {state().mode === "edit"
          ? `编辑 Workflow 配置 · ${state().answers.name}`
          : state().mode === "edit-structure"
            ? `编辑 Workflow 结构 · ${state().answers.name}`
            : "创建 Workflow"}
      </text>

      {/* 窄屏：顶部步骤条（R6.9） */}
      <Show when={narrow()}>{renderStepBar()}</Show>

      <text fg={theme().borderSubtle}>{dividerLine()}</text>

      {/* 主体：三栏（导航 | 编辑 | 实时预览）/ 双栏 / 窄屏单栏 */}
      <box flexDirection="row" flexGrow={1}>
        <Show when={!narrow()}>{renderLeftColumn()}</Show>
        <box flexDirection="column" flexGrow={1} paddingLeft={narrow() ? 0 : 1} paddingRight={wide() ? 1 : 0}>
          {renderRightColumn()}
        </box>
        <Show when={wide()}>{renderPreviewPane()}</Show>
      </box>

      {/* 底栏：实时脚本预览（仅在非三栏宽度下显示；三栏时预览已移至右栏，R3.1/R3.2） */}
      <Show when={!wide()}>
        <text fg={theme().borderSubtle}>{dividerLine()}</text>
        <text fg={theme().textMuted}>{`预览（生成脚本 · 前 ${PREVIEW_LINES} 行 · 随填随更新）`}</text>
        <For each={previewLines()}>{(line) => <text fg={theme().textMuted}>{`  ${line}`}</text>}</For>
      </Show>

      {/* 状态栏：键位 */}
      <text fg={theme().borderSubtle}>{dividerLine()}</text>
      <text fg={theme().textMuted}>{statusHints()}</text>
    </box>
  )

  // ── 渲染辅助 ──

  /**
   * 右侧常驻实时脚本预览栏（三栏布局，R3.1/R3.2 升级）。
   *
   * 展示 fullScript() 完整脚本（非底栏的前 12 行），按 previewScroll 滚动视口；只读、不抢焦点
   * （中栏 textarea/表单优先），滚动经全局 PgUp/PgDn。脚本随 intent/字段实时变化。
   */
  function renderPreviewPane(): JSX.Element {
    const lines = fullScript()
    const viewport = Math.max(4, dim().height - 16)
    const from = clampIndex(previewScroll(), Math.max(1, lines.length))
    const shown = lines.slice(from, from + viewport)
    const to = Math.min(from + viewport, lines.length)
    return (
      <box flexDirection="column" width={PREVIEW_PANE_WIDTH} paddingLeft={1}>
        <text fg={theme().textMuted}>{`│ 脚本预览（实时 · ${from + 1}-${to}/${lines.length} · PgUp/PgDn）`}</text>
        <For each={shown}>{(line) => <text fg={theme().text}>{`│ ${line}`}</text>}</For>
      </box>
    )
  }

  function renderStepBar(): JSX.Element {
    const steps = visibleSteps()
    const parts = steps.map((step, i) => {
      const icon = summaryOf(step)?.icon
      const prefix = icon === "current" ? "▶" : ""
      const suffix = icon === "done" ? "✔" : ""
      return `${prefix}${i + 1}${suffix}`
    })
    return <text fg={theme().text}>{`[ ${parts.join(" ")} ]`}</text>
  }

  function renderLeftColumn(): JSX.Element {
    const steps = visibleSteps()
    return (
      <box flexDirection="column" width={LEFT_WIDTH} paddingRight={1}>
        <text fg={theme().textMuted}>步骤</text>
        <For each={steps}>
          {(step, i) => {
            const sum = () => summaryOf(step)
            const onCursor = () => i() === clampIndex(stepCursor(), steps.length) && region() === "left"
            const isCurrent = () => state().mainStep === step
            const icon = () => {
              const s = sum()
              return s ? iconChar(s.icon) : " "
            }
            const summaryText = () => {
              const s = sum()
              return s && s.summary ? `  ${s.summary}` : ""
            }
            return (
              <box onMouseDown={() => gotoStep(step)}>
                <text fg={onCursor() ? theme().accent : isCurrent() ? theme().text : theme().textMuted}>
                  {`${onCursor() ? ">" : " "}${icon()} ${i() + 1} ${STEP_TITLES[step]}${summaryText()}`}
                </text>
              </box>
            )
          }}
        </For>
      </box>
    )
  }

  function renderRightColumn(): JSX.Element {
    const st = state()
    return (
      <box flexDirection="column" flexGrow={1}>
        {renderStepBody(st.mainStep)}
        {/* 右栏常驻校验提示（非瞬时 toast，R4.4） */}
        <Show when={st.stepError}>
          <text fg={theme().warning}>{`⚠ ${st.stepError}`}</text>
        </Show>
      </box>
    )
  }

  function renderStepBody(step: WizardStep): JSX.Element {
    const st = state()
    if (st.stepEditor.kind === "edit" && step === "steps") return renderStepEditor()
    if (st.resourceEditor.kind === "edit" && step === "config") return renderResourceEditor()
    switch (step) {
      case "name":
        return renderTextStep("名称（kebab-case，必填）", nameDraft, setNameDraft, st.mode !== "create")
      case "desc":
        return renderTextStep("描述（可空）", descDraft, setDescDraft)
      case "args":
        return renderTextStep("自定义参数名（逗号/空格分隔，可空）", argsDraft, setArgsDraft)
      case "phases":
        return renderPhases()
      case "steps":
        return renderStepList()
      case "config":
        return renderConfig()
      case "confirm":
        return renderConfirm()
      default:
        return <text fg={theme().text}>{`当前步骤：${STEP_TITLES[step]}`}</text>
    }
  }

  function renderTextStep(
    label: string,
    value: () => string,
    onInput: (v: string) => void,
    readOnly = false,
  ): JSX.Element {
    const focused = () => region() === "right"
    return (
      <box flexDirection="column">
        <text fg={theme().text}>{label}</text>
        <Show when={!readOnly} fallback={<text fg={theme().textMuted}>{value() || "—"}</text>}>
          <input value={value()} focused={focused()} onInput={onInput} onSubmit={() => goNext()} placeholder="在此输入…" />
        </Show>
        <text fg={theme().textMuted}>Enter 前进 · ← 后退 · Esc 回左栏总览</text>
      </box>
    )
  }

  function renderPhases(): JSX.Element {
    const phases = state().answers.phases
    const editing = phaseEdit()
    return (
      <box flexDirection="column">
        <text fg={theme().textMuted}>{`阶段（${phases.length}）— 留空将回退为 ["Main"]`}</text>
        <For each={phases}>
          {(p, i) => {
            const on = () => i() === clampIndex(listCursor(), phases.length + 1) && region() === "right" && !editing
            return (
              <box onMouseDown={() => gotoStep("phases")}>
                <text fg={on() ? theme().accent : theme().text}>{`${on() ? ">" : " "} ${i() + 1}. ${p}`}</text>
              </box>
            )
          }}
        </For>
        <Show when={editing}>
          <box flexDirection="column">
            <text fg={theme().accent}>{`${(editing?.index ?? 0) >= phases.length ? "新增阶段" : "编辑阶段"}：`}</text>
            <input value={phaseDraft()} focused={true} onInput={(v) => setPhaseDraft(v)} onSubmit={() => commitPhase()} placeholder="阶段标题…" />
            <text fg={theme().textMuted}>Enter 保存 · Esc 放弃</text>
          </box>
        </Show>
        <Show when={!editing}>
          <text
            fg={
              listCursor() >= phases.length && region() === "right"
                ? theme().accent
                : theme().textMuted
            }
          >
            {`${listCursor() >= phases.length && region() === "right" ? ">" : " "} ＋ 添加阶段（a）`}
          </text>
          <text fg={theme().textMuted}>↑/↓ 选择 · Enter 编辑 · a 添加 · d 删除 · Shift+↑/↓ 调序 · → 前进</text>
        </Show>
      </box>
    )
  }

  function renderStepList(): JSX.Element {
    const steps = state().answers.steps
    return (
      <box flexDirection="column">
        <text fg={theme().textMuted}>{`步骤（${steps.length}）— 至少 1 步`}</text>
        <For each={steps}>
          {(s, i) => {
            const on = () => i() === clampIndex(listCursor(), steps.length + 1) && region() === "right"
            const at = s.agentType ? ` · ${s.agentType}` : ""
            const label = s.label && s.label.length > 0 ? s.label : `步骤 ${i() + 1}`
            return (
              <box onMouseDown={() => openStepEditor(i())}>
                <text fg={on() ? theme().accent : theme().text}>
                  {`${on() ? ">" : " "} ${i() + 1}. [${kindLabel(s.kind)}] ${label} @${s.phase}${at}`}
                </text>
              </box>
            )
          }}
        </For>
        <text
          fg={
            listCursor() >= steps.length && region() === "right" ? theme().accent : theme().textMuted
          }
        >
          {`${listCursor() >= steps.length && region() === "right" ? ">" : " "} ＋ 添加步骤（a）`}
        </text>
        <text fg={theme().textMuted}>↑/↓ 选择 · Enter 编辑 · a 添加 · d 删除 · Shift+↑/↓ 调序 · → 前进</text>
      </box>
    )
  }

  /**
   * 渲染步骤子表单内的分支/维度列表子区域（R9.1/R9.2）。
   *
   * - 字段聚焦但未进入子编辑（subMode!=="list"/"item"）：显示「进入提示 + 当前列表概览」。
   * - 进入子编辑（subMode==="list"）：渲染列表行（label/name · intent 摘要 · agentType），
   *   带行游标，支持 a/d/Enter/Shift+↑↓。
   * - 进项编辑（subMode==="item"）：渲染项内字段（primary/intent），文本字段以本地草稿信号驱动（B1/B2）。
   *
   * 数据一律取自 stepEditor.draft（唯一真相，R9.4）。
   */
  function renderSubList(field: "branches" | "dimensions", fieldFocused: () => boolean): JSX.Element {
    const isBranch = field === "branches"
    const areaTitle = isBranch ? "分支" : "维度"
    const list = (): (BranchSpec | DimensionSpec)[] => activeSubList()
    const primaryOf = (item: BranchSpec | DimensionSpec): string =>
      isBranch ? (item as BranchSpec).label : (item as DimensionSpec).name
    // 注意：active/marker 等必须是 reactive 访问器——renderSubList 仅在字段 For 中被调用一次，
    // 后续 subMode/焦点 变化要靠这些访问器在 JSX 中重新求值（否则进/退子编辑模式不会刷新，B2）。
    const active = (): boolean => fieldFocused() && (subMode() === "list" || subMode() === "item")
    const marker = (): string => (fieldFocused() ? "> " : "  ")
    const fallbackLabel = (i: number) => `${areaTitle} ${i + 1}`
    return (
      <box flexDirection="column">
        <text fg={fieldFocused() ? theme().accent : theme().text}>
          {`${marker()}${areaTitle}列表（${list().length}）${active() ? "" : fieldFocused() ? "— Enter 进入子编辑" : ""}`}
        </text>
        <For each={list()}>
          {(item, i) => {
            const onRow = () => active() && i() === clampIndex(subCursor(), list().length)
            const editingItem = () => onRow() && subMode() === "item"
            const primaryText = () => {
              const p = primaryOf(item)
              return p && p.length > 0 ? p : fallbackLabel(i())
            }
            const intentSummary = () => {
              const t = item.intent ?? ""
              return t.length > 0 ? truncateLine(t, 24) : "（无意图）"
            }
            const at = () => (item.agentType ? ` · ${item.agentType}` : "")
            return (
              <Show
                when={editingItem()}
                fallback={
                  <text fg={onRow() ? theme().accent : theme().text}>
                    {`   ${onRow() ? ">" : " "} ${i() + 1}. ${primaryText()} · ${intentSummary()}${at()}`}
                  </text>
                }
              >
                <box flexDirection="column">
                  <box flexDirection="column">
                    <text fg={subFieldCursor() === 0 ? theme().accent : theme().text}>
                      {`     ${subFieldCursor() === 0 ? "> " : "  "}${isBranch ? "标签" : "维度名"}：`}
                    </text>
                    <Show
                      when={subFieldCursor() === 0}
                      fallback={<text fg={theme().textMuted}>{`       ${subPrimaryDraft() || "—"}`}</text>}
                    >
                      <input value={subPrimaryDraft()} focused={true} onInput={setSubPrimaryDraft} onSubmit={() => { commitSubItem(); setSubMode("list") }} placeholder="在此输入…" />
                    </Show>
                  </box>
                  {/* 意图 / Agent Prompt：多行 textarea（与主步骤 intent 同模型，Enter 进编辑 / Esc 离开）。 */}
                  <box flexDirection="column">
                    <text fg={subFieldCursor() === 1 ? theme().accent : theme().text}>
                      {`     ${subFieldCursor() === 1 ? "> " : "  "}意图 / Agent Prompt${
                        subFieldCursor() === 1 && !subIntentEditing()
                          ? "（Enter 编辑）"
                          : subIntentEditing()
                            ? "（Enter 换行 · Esc 离开）"
                            : ""
                      }：`}
                    </text>
                    <Show
                      when={subFieldCursor() === 1 && subIntentEditing()}
                      fallback={
                        <Show
                          when={subIntentDraft().length > 0}
                          fallback={<text fg={theme().textMuted}>{"       —"}</text>}
                        >
                          <For each={subIntentDraft().split("\n")}>
                            {(ln) => <text fg={theme().textMuted}>{`       ${ln}`}</text>}
                          </For>
                        </Show>
                      }
                    >
                      <box height={6} border borderColor={theme().accent}>
                        <textarea
                          ref={(el: { plainText?: string } | undefined) => (subIntentTextareaRef = el)}
                          initialValue={subIntentDraft()}
                          focused={true}
                          onContentChange={() => {
                            if (subIntentTextareaRef && typeof subIntentTextareaRef.plainText === "string") {
                              setSubIntentDraft(subIntentTextareaRef.plainText)
                            }
                          }}
                          placeholder="描述该分支/维度要让 Agent 做什么（支持多行）…"
                        />
                      </box>
                    </Show>
                  </box>
                </box>
              </Show>
            )
          }}
        </For>
        <text fg={theme().textMuted}>{`    ＋ 添加${areaTitle}（a）`}</text>
        <Show when={active() && subMode() === "list"}>
          <text fg={theme().textMuted}>{`   a 添加 · d 删除 · Enter 进项编辑 · Shift+↑/↓ 调序 · Esc 退回字段`}</text>
        </Show>
        <Show when={active() && subMode() === "item"}>
          <text fg={theme().textMuted}>{`   ↑/↓ 切字段 · 意图 Enter 进多行/Esc 离开 · Enter 返回列表`}</text>
        </Show>
      </box>
    )
  }

  function renderStepEditor(): JSX.Element {
    const st = state()
    if (st.stepEditor.kind !== "edit") return <text fg={theme().text}>—</text>
    const draft = st.stepEditor.draft
    const fields = stepFieldsForKind(draft.kind)
    const onSaveRow = () => clampIndex(fieldCursor(), fields.length + 1) === fields.length
    const activeField = () => (onSaveRow() ? null : fields[clampIndex(fieldCursor(), fields.length)])
    const cats = declaredCategories()
    // 暂仅暴露默认执行 Agent（build）；完整 /agent 候选由 AGENT_SELECTION_ENABLED 控制（agentOptions 逻辑保留，未删除）。
    const agentNames = AGENT_SELECTION_ENABLED
      ? [DEFAULT_AGENT_LABEL, ...st.agentOptions.map((o) => o.name)]
      : [DEFAULT_AGENT_LABEL]
    return (
      <box flexDirection="column">
        <text fg={theme().accent}>{`编辑步骤 #${st.stepEditor.index + 1}`}</text>
        <For each={fields}>
          {(field) => {
            const focused = () => field === activeField()
            const marker = () => (focused() ? "> " : "  ")
            if (field === "phase") {
              return <text fg={focused() ? theme().accent : theme().text}>{`${marker()}归属阶段：‹ ${draft.phase} ›`}</text>
            }
            if (field === "kind") {
              return <text fg={focused() ? theme().accent : theme().text}>{`${marker()}编排模式：‹ ${kindLabel(draft.kind)} ›`}</text>
            }
            if (field === "agentType") {
              const cur = draft.agentType === "explore" ? "explore" : DEFAULT_AGENT_LABEL
              // M2: build/explore 两项，中文提示说明区别。
              const hint =
                cur === "explore"
                  ? "（只读代码探索：仅分析不修改文件）"
                  : "（通用构建：可读写文件、执行命令）"
              return (
                <text fg={focused() ? theme().accent : theme().text}>
                  {`${marker()}执行 Agent：‹ ${cur} › ${hint}`}
                </text>
              )
            }
            if (field === "useConfig") {
              const rendered =
                cats.length === 0
                  ? "（无已声明类别）"
                  : cats
                      .map((c, i) => {
                        const checked = draft.useConfig.includes(c) ? "[x]" : "[ ]"
                        const cursorMark = focused() && i === clampIndex(useConfigCursor(), cats.length) ? "‹" : " "
                        return `${cursorMark}${checked}${c}`
                      })
                      .join(" ")
              return <text fg={focused() ? theme().accent : theme().text}>{`${marker()}参考资源：${rendered}`}</text>
            }
            if (field === "useSteps") {
              const refs = earlierSteps()
              const selected = draft.useSteps ?? []
              const rendered =
                refs.length === 0
                  ? "（无更早步骤）"
                  : refs
                      .map((r, i) => {
                        const checked = selected.includes(r.id) ? "[x]" : "[ ]"
                        const cursorMark = focused() && i === clampIndex(useStepsCursor(), refs.length) ? "‹" : " "
                        return `${cursorMark}${checked}${r.label}`
                      })
                      .join(" ")
              return <text fg={focused() ? theme().accent : theme().text}>{`${marker()}引用上游步：${rendered}`}</text>
            }
            if (field === "branches" || field === "dimensions") {
              return renderSubList(field, focused)
            }
            // 文本字段：聚焦时渲染 <input>（绑定本地草稿信号，避免每次按键重建节点）。
            const draftAccessor: () => string =
              field === "label"
                ? stepLabelDraft
                : field === "intent"
                  ? stepIntentDraft
                  : field === "subflowName"
                    ? stepSubflowDraft
                    : field === "fanout"
                      ? stepFanoutDraft
                      : stepMaxRoundsDraft
            const setDraft: (v: string) => void =
              field === "label"
                ? setStepLabelDraft
                : field === "intent"
                  ? setStepIntentDraft
                  : field === "subflowName"
                    ? setStepSubflowDraft
                    : field === "fanout"
                      ? setStepFanoutDraft
                      : setStepMaxRoundsDraft
            const labelText =
              field === "label"
                ? "标签"
                : field === "intent"
                  ? "意图"
                  : field === "subflowName"
                    ? "子流程名"
                    : field === "fanout"
                      ? "并发分支(2-16)"
                      : "最大轮次(1-10)"
            // intent（agent prompt）：主操作区，渲染为多行 textarea。聚焦且进入编辑时挂载 textarea
            // （uncontrolled：initialValue 仅在挂载时 seed，onContentChange 回写本地草稿，规避受控光标错乱）。
            // 未编辑时显示多行只读预览 + 「Enter 编辑」提示。
            if (field === "intent") {
              const lines = () => (stepIntentDraft().length > 0 ? stepIntentDraft().split("\n") : [])
              return (
                <box flexDirection="column">
                  <text fg={focused() ? theme().accent : theme().text}>
                    {`${marker()}意图 / Agent Prompt${focused() && !intentEditing() ? "（Enter 编辑）" : intentEditing() ? "（Enter 换行 · Esc 离开）" : ""}：`}
                  </text>
                  <Show
                    when={intentEditing()}
                    fallback={
                      <Show
                        when={lines().length > 0}
                        fallback={<text fg={theme().textMuted}>{"  （空 · 聚焦后 Enter 进入多行编辑）"}</text>}
                      >
                        <For each={lines()}>{(ln) => <text fg={theme().textMuted}>{`  ${ln}`}</text>}</For>
                      </Show>
                    }
                  >
                    <box height={8} border borderColor={theme().accent}>
                      <textarea
                        ref={(el: { plainText?: string } | undefined) => (intentTextareaRef = el)}
                        initialValue={stepIntentDraft()}
                        focused={true}
                        onContentChange={() => {
                          // ContentChangeEvent 为空对象（不带文本），须经 ref.plainText 读取实际内容。
                          if (intentTextareaRef && typeof intentTextareaRef.plainText === "string") {
                            setStepIntentDraft(intentTextareaRef.plainText)
                          }
                        }}
                        placeholder="描述这一步要让 Agent 做什么（支持多行）…"
                      />
                    </box>
                  </Show>
                </box>
              )
            }
            return (
              <box flexDirection="column">
                <text fg={focused() ? theme().accent : theme().text}>
                  {`${marker()}${labelText}${
                    focused() && !stepTextEditing()
                      ? "（Enter 编辑）"
                      : focused() && stepTextEditing()
                        ? "（输入中 · Enter/Esc 完成）"
                        : ""
                  }：`}
                </text>
                <Show
                  when={focused() && stepTextEditing()}
                  fallback={<text fg={theme().textMuted}>{`   ${draftAccessor() || "—"}`}</text>}
                >
                  <input value={draftAccessor()} focused={true} onInput={setDraft} onSubmit={() => { commitStepDrafts(); setStepTextEditing(false) }} placeholder="在此输入…" />
                </Show>
                {/* B3 修复：fanout/maxRounds 为数字字段，输入非数字或越界时给出明确提示（否则提交时静默丢弃）。 */}
                <Show when={(field === "fanout" || field === "maxRounds") && numericFieldWarning(field as "fanout" | "maxRounds", draftAccessor()) !== ""}>
                  <text fg={theme().warning}>{`   ${numericFieldWarning(field as "fanout" | "maxRounds", draftAccessor())}`}</text>
                </Show>
              </box>
            )
          }}
        </For>
        {/* 保存行：导航态末项，Enter 提交整个步骤（与资源编辑器同款两态模型）。 */}
        <text fg={onSaveRow() ? theme().accent : theme().textMuted}>
          {`${onSaveRow() ? "> " : "  "}✓ 保存步骤`}
        </text>
        <Show when={askWarning()}>
          <text fg={theme().warning}>{askWarning() as string}</text>
        </Show>
        <text fg={theme().textMuted}>
          {stepTextEditing()
            ? "输入中 · Enter/Esc 完成本字段回到字段导航"
            : intentEditing()
              ? "多行编辑中 · Enter 换行 · Esc 离开"
              : "↑/↓ 选择字段 · ←/→ 选值 · Space 勾选资源/上游步 · Enter 编辑该项 / 在「保存步骤」行提交 · Esc 取消 · Ctrl+S 生成"}
        </text>
      </box>
    )
  }

  function renderConfig(): JSX.Element {
    const st = state()
    const rows = configRows()
    const resCount = countTotalResourceCategories(st.config.resources)
    const phases = st.answers.phases.length > 0 ? st.answers.phases : ["Main"]
    // 当前光标行索引（钳制到行模型长度）。on(i) 判定第 i 行是否选中。
    const cursorOf = () => clampIndex(configCursor(), rows.length)
    const on = (i: number) => region() === "right" && i === cursorOf()

    return (
      <box flexDirection="column">
        {/* 配置来源行：file 态显示完整文件路径；builtin 态简短标注。 */}
        <Show
          when={configSource() === "file"}
          fallback={
            <Show when={configSource() === "builtin"} fallback={null}>
              <text fg={theme().textMuted}>{`配置来源：内置默认`}</text>
            </Show>
          }
        >
          <text fg={theme().textMuted}>
            {`配置来源：${props.globalDir ? join(props.globalDir, `${props.editName ?? ""}.config.json`) : `~/.opencode-workflows/${props.editName ?? ""}.config.json`}`}
          </text>
        </Show>
        <text fg={theme().textMuted}>{`资源类别（${resCount}）· 按阶段分组树 · Enter 折叠/展开阶段 · 阶段内 a 新增`}</text>
        <For each={rows}>
          {(item, i) => {
            const idx = i()
            if (item.kind === "phase-header") {
              // 折叠/展开标记 + 该阶段类别数。展开 ▼ / 折叠 ▶。
              const mark = item.expanded ? "▼" : "▶"
              return (
                <box onMouseDown={() => togglePhaseCollapse(item.phase)}>
                  <text fg={on(idx) ? theme().accent : theme().accent}>
                    {`${on(idx) ? ">" : " "} ${mark} 【${item.phase} 阶段】（${item.categoryCount} 类）`}
                  </text>
                </box>
              )
            }
            if (item.kind === "resource") {
              const extra = item.paths.length > 1 ? ` (+${item.paths.length - 1})` : ""
              const first = item.paths[0] ?? "（未填路径）"
              return (
                <box onMouseDown={() => { if (item.globalIndex >= 0) openResEditor(item.globalIndex) }}>
                  <text fg={on(idx) ? theme().accent : theme().text}>
                    {`${on(idx) ? ">" : " "}     • ${item.category}  ${first}${extra}`}
                  </text>
                </box>
              )
            }
            if (item.kind === "add-category") {
              return (
                <text fg={on(idx) ? theme().accent : theme().textMuted}>
                  {`${on(idx) ? ">" : " "}     ＋ 新增类别（a / Enter）`}
                </text>
              )
            }
            if (item.kind === "out-phase") {
              return (
                <box flexDirection="column">
                  <text fg={on(idx) ? theme().accent : theme().text}>
                    {`${on(idx) ? "> " : "  "}落盘/轮次配置阶段：${on(idx) ? "（←/→ 切换阶段）" : ""}`}
                  </text>
                  <text fg={theme().textMuted}>{`    ‹ ${outPhaseDraft() || phases[0]} ›  （共 ${phases.length} 个阶段：${phases.join(", ")}）`}</text>
                </box>
              )
            }
            if (item.kind === "output-path") {
              // 不支持配置的 workflow（内置默认无落盘，如 default-code）：显示说明文案、
              // 不可编辑（onConfigListKey 已拦截 Enter）。
              if (builtinNoOutput()) {
                return (
                  <text fg={theme().textMuted}>
                    {`${on(idx) ? "> " : "  "}落盘路径(output_path · ${outPhaseDraft() || phases[0]})：不支持配置，代码由子 Agent 按项目结构写入`}
                  </text>
                )
              }
              return (
                <>
                  <text fg={on(idx) ? theme().accent : theme().text}>
                    {`${on(idx) ? "> " : "  "}落盘路径(output_path · ${outPhaseDraft() || phases[0]})：${
                      on(idx) ? (configEditing() ? "（编辑中 · Enter 完成 · Esc 取消）" : "（Enter 编辑）") : ""
                    }`}
                  </text>
                  <Show
                    when={on(idx) && configEditing()}
                    fallback={<text fg={theme().textMuted}>{`    ${outputDraft() || "（未配置 → 不落盘）"}`}</text>}
                  >
                    <box paddingLeft={2}>
                      <input
                        value={outputDraft()}
                        focused={true}
                        onInput={setOutputDraft}
                        onSubmit={() => {
                          commitTextDrafts()
                          setConfigEditing(false)
                        }}
                        placeholder="docs/<FEATURE>/设计文档.md（留空 = 该阶段不落盘）"
                      />
                    </box>
                  </Show>
                </>
              )
            }
            if (item.kind === "max-review-rounds") {
              return (
                <>
                  <text fg={on(idx) ? theme().accent : theme().text}>
                    {`${on(idx) ? "> " : "  "}最大审查轮次(max_review_rounds · ${outPhaseDraft() || phases[0]}，1-10，默认 3)：${
                      on(idx) ? (configEditing() ? "（编辑中 · Enter 完成 · Esc 取消）" : "（Enter 编辑）") : ""
                    }`}
                  </text>
                  <Show
                    when={on(idx) && configEditing()}
                    fallback={<text fg={theme().textMuted}>{`    ${mrrDraft() || "（默认 3）"}`}</text>}
                  >
                    <box paddingLeft={2}>
                      <input
                        value={mrrDraft()}
                        focused={true}
                        onInput={setMrrDraft}
                        onSubmit={() => {
                          commitTextDrafts()
                          setConfigEditing(false)
                        }}
                        placeholder="3"
                      />
                    </box>
                  </Show>
                </>
              )
            }
            return null
          }}
        </For>
        <text fg={theme().textMuted}>↑/↓ 选择 · Enter 折叠展开阶段/编辑类别/录入 · a 阶段内新增 · d 删除 · Shift+↑/↓ 同阶段调序 · ←/→ 切落盘阶段 · → 前进</text>
      </box>
    )
  }

  function renderResourceEditor(): JSX.Element {
    const st = state()
    if (st.resourceEditor.kind !== "edit") return <text fg={theme().text}>—</text>
    const SAVE_INDEX = RES_FIELDS.length
    const cur = () => clampIndex(resFieldCursor(), RES_FIELDS.length + 1)
    const phases = () => (st.answers.phases.length > 0 ? st.answers.phases : ["Main"])
    // 内置 workflow（default-*）判定：其脚本不读取引导语（手写 prompt），该字段只读。
    const isBuiltinWf = !!(props.editName && props.builtinDefaults?.(props.editName))
    // 类别用途（随「类别名」草稿实时切换，文案经内置脚本消费链验证）。
    const categoryUsage = (category: string): string => {
      switch ((category || "").trim().toLowerCase()) {
        case "template":
          return "模板路径，检索步读取并提炼其结构，供下游生成遵循"
        case "rules":
          return "工程规约路径，约束生成内容"
        case "review":
          return "审查清单，门禁审查步逐条对照，判定产出是否通过"
        default:
          return "自定义类别路径，按下方「引导语」的指示提供给子 Agent"
      }
    }
    const textRows: { field: ResField; label: string; hint: string; value: () => string; set: (v: string) => void }[] = [
      { field: "category", label: "类别名", hint: "template=模板 / rules=规约 / review=审查清单（自定义名也可）", value: resCategoryDraft, set: setResCategoryDraft },
      { field: "paths", label: "路径", hint: "逗号分隔本地路径；留空或 none = 该维度不审查（直接判过）", value: resPathsDraft, set: setResPathsDraft },
      {
        field: "label",
        label: "引导语",
        hint: isBuiltinWf ? "内置 workflow 不读取引导语" : "子 Agent 读取该资源的指令语（留空用默认）",
        value: resLabelDraft,
        set: setResLabelDraft,
      },
    ]
    return (
      <box flexDirection="column">
        <text fg={theme().accent}>{`编辑资源类别 #${st.resourceEditor.index + 1}`}</text>
        {/* 归属阶段：改动 A 后由阶段分组树上下文自动决定，此处只读展示，不可在子表单内更改。 */}
        <text fg={theme().textMuted}>{`  归属阶段：${resPhaseDraft() || phases()[0]}（由所在阶段自动归属）`}</text>
        {/* 类别用途：随类别名输入实时切换（template/rules/review/自定义四态）。 */}
        <text fg={theme().textMuted}>{`  用途：${categoryUsage(resCategoryDraft())}`}</text>
        <For each={textRows}>
          {(row, i) => {
            // 改动 A：phase 已移出 RES_FIELDS，文本字段下标即 i()（类别名=0/路径=1/引导语=2）。
            const fieldIndex = () => i()
            const active = () => fieldIndex() === cur()
            const editing = () => active() && resEditing()
            // 内置 workflow 的引导语字段：只读（脚本不读取，编辑了也不生效——onResEditorKey 拦截 Enter）。
            const locked = () => row.field === "label" && isBuiltinWf
            const tag = () =>
              editing() ? "（编辑中 · Enter 下一项 · Esc 完成）" : locked() ? "（不支持编辑）" : active() ? "（Enter 编辑）" : ""
            const displayValue = () => (locked() ? "内置 workflow 不读取引导语" : row.value())
            return (
              <box flexDirection="column">
                <text fg={active() ? theme().accent : theme().text}>
                  {`${active() ? "> " : "  "}${row.label}  ${tag()}`}
                </text>
                <Show
                  when={editing()}
                  fallback={<text fg={theme().textMuted}>{`    ${displayValue() || `（空 · ${row.hint}）`}`}</text>}
                >
                  <box paddingLeft={2}>
                    <input value={row.value()} focused={true} onInput={row.set} onSubmit={() => resEditAdvance()} placeholder={row.hint} />
                  </box>
                </Show>
              </box>
            )
          }}
        </For>
        {/* 保存行：导航态末项，Enter 提交整个资源类别。 */}
        <text fg={cur() === SAVE_INDEX ? theme().accent : theme().textMuted}>
          {`${cur() === SAVE_INDEX ? "> " : "  "}✓ 保存该类别`}
        </text>
        <text fg={theme().textMuted}>
          {resEditing()
            ? "输入中 · Enter 提交并到下一项 · Esc 完成本项回到字段列表"
            : "↑/↓ 选择字段 · Enter 编辑该项 / 在「保存」行提交 · Esc 取消"}
        </text>
      </box>
    )
  }


  function renderConfirm(): JSX.Element {
    const st = state()
    const lines = fullScript()
    const viewport = Math.max(4, dim().height - 16)
    const from = clampIndex(scrollOffset(), Math.max(1, lines.length))
    const shown = lines.slice(from, from + viewport)
    // 按阶段汇总资源类别（per-phase）：每个阶段一行 "阶段: cat1, cat2"。
    const resByPhase: string[] = []
    for (const [phase, categories] of Object.entries(st.config.resources)) {
      const cats = Object.keys(categories)
      if (cats.length > 0) resByPhase.push(`${phase}: ${cats.join(", ")}`)
    }
    const resSummary = resByPhase.length > 0 ? resByPhase : ["—"]
    // 按阶段汇总落盘路径（per-phase）。
    const outByPhase: string[] = []
    for (const [phase, path] of Object.entries(st.config.outputPath)) {
      if (path) outByPhase.push(`${phase}: ${path}`)
    }
    const outSummary = outByPhase.length > 0 ? outByPhase : ["—"]
    const summary = (): JSX.Element => (
      <box flexDirection="column" width={wide() ? undefined : 28} flexGrow={wide() ? 1 : undefined} paddingRight={1}>
        <text fg={theme().text}>{`名称  ${st.answers.name || "—"}`}</text>
        <text fg={theme().text}>{`阶段  ${(st.answers.phases.length ? st.answers.phases : ["Main"]).join(", ")}`}</text>
        <text fg={theme().text}>{`步骤  ${st.answers.steps.length} 步`}</text>
        <text fg={theme().text}>{`资源  ${resSummary[0]}`}</text>
        <For each={resSummary.slice(1)}>{(line) => <text fg={theme().text}>{`      ${line}`}</text>}</For>
        <text fg={theme().text}>{`落盘  ${outSummary[0]}`}</text>
        <For each={outSummary.slice(1)}>{(line) => <text fg={theme().text}>{`      ${line}`}</text>}</For>
        <Show when={st.mode === "create"}>
          <text fg={theme().textMuted}>{`文件  ${st.answers.name || "<name>"}.mjs`}</text>
          <text fg={theme().textMuted}>{`      ${st.answers.name || "<name>"}.config.json`}</text>
          <text fg={theme().textMuted}>{`      ${st.answers.name || "<name>"}.draft.json`}</text>
        </Show>
        <Show when={st.mode === "edit-structure"}>
          <text fg={theme().textMuted}>{`重写  ${st.answers.name}.mjs`}</text>
          <text fg={theme().textMuted}>{`      ${st.answers.name}.config.json`}</text>
          <text fg={theme().textMuted}>{`      ${st.answers.name}.draft.json`}</text>
        </Show>
        <Show when={st.mode === "edit"}>
          <text fg={theme().textMuted}>{`文件  ${st.answers.name}.config.json`}</text>
        </Show>
        <text fg={theme().textMuted}>
          {submitting() ? "正在落盘…" : "Ctrl+S / Enter 生成并落盘 · Esc 取消 · ← 返回"}
        </text>
      </box>
    )
    // 三栏宽度：右侧常驻预览栏已显示完整脚本，确认页中栏只放聚合摘要，避免重复。
    if (wide()) return summary()
    // 双栏/窄屏：确认页内联「摘要 + 完整脚本滚动预览」（原行为）。
    return (
      <box flexDirection="row" flexGrow={1}>
        {summary()}
        <box flexDirection="column" flexGrow={1}>
          <text fg={theme().textMuted}>{`完整脚本预览（↑/↓ 或 j/k 滚动 · ${from + 1}-${Math.min(from + viewport, lines.length)}/${lines.length}）`}</text>
          <For each={shown}>{(line) => <text fg={theme().text}>{line}</text>}</For>
        </box>
      </box>
    )
  }

  function statusHints(): string {
    const st = state()
    if (region() === "left") return "↑/↓ 切步骤 · Enter 进入 · ← 后退 · → 前进 · Ctrl+S 生成 · Esc 取消"
    switch (st.mainStep) {
      case "confirm":
        return "↑/↓ 滚动 · Ctrl+S/Enter 生成 · ← 返回 · Esc 回左栏"
      case "phases":
      case "steps":
      case "config":
        return "↑/↓ 选择 · Enter 编辑 · a 添加 · d 删除 · Shift+↑/↓ 调序 · → 前进 · Ctrl+S 生成 · Esc 回左栏"
      default:
        return "输入文本 · Enter 前进 · Ctrl+S 生成 · Esc 回左栏"
    }
  }
}

// ============================================================================
// 模块级纯工具
// ============================================================================

/** 在数组中按方向循环取下一个值（空数组返回原值）。 */
function cycle<T>(arr: T[], cur: T, dir: 1 | -1): T {
  if (arr.length === 0) return cur
  const i = arr.indexOf(cur)
  const ni = (i + dir + arr.length) % arr.length
  return arr[ni]
}

/** 在 useConfig 列表中切换某类别的勾选状态。 */
function toggleUseConfig(cur: string[], cat: string): string[] {
  return cur.includes(cat) ? cur.filter((c) => c !== cat) : [...cur, cat]
}

/** 在 useSteps 引用列表中切换某上游步 id 的勾选状态（A2-full）。 */
function toggleStepRef(cur: string[], id: string): string[] {
  return cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]
}

/** 截断单行文本到 ≤ max（超出加省略号）。 */
function truncateLine(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, Math.max(0, max - 1)) + "…"
}
