/**
 * OpenCode Workflows —— TUI 斜杠命令编排（无 JSX，可独立测试）。
 *
 * 本模块把「7 条 `/workflows-*` 斜杠命令」的交互编排（运行态过滤、DialogSelect/
 * DialogConfirm 弹框、调用 E_tui、toast 反馈）从 `tui.tsx` 入口拆出，置于无 JSX 的
 * `.ts` 模块，便于单测（绕过 JSX 运行时）。
 *
 * 命令收敛（见 docs/WF-Studio统一与命令收敛方案.md）：workflow **类型**的增删改查统一进
 * `/workflows-studio` 全屏（意图菜单，见 `studio-screen.tsx`）；本模块只保留 7 条命令的注册
 * 与 **run 实例**相关编排（run / studio 入口 / monitor / resume / pause / cancel / delete）。
 *
 * 设计要点：
 *
 * - **可联想**：经 `api.command.register({ slash: { name, aliases } })` 注册 7 条命令，
 *   每条带 `wf-*` 短别名，输入框可补全（R1.1/R1.2）。
 * - **Studio 入口**：`/workflows-studio`（别名 `wf-studio`）经
 *   {@link WorkflowCommandsDeps.navigateStudio} 导航进入 `workflow-studio` 全屏路由，由
 *   `studio-screen.tsx` 承载意图菜单（浏览 / 新建 / 改配置 / 改结构 / 删除类型）。
 * - **run 两步交互**：`/workflows-run` 先 `DialogSelect` 选 workflow，再 `DialogPrompt`
 *   收集本次运行的需求/提示词作为 `args.feature` 注入（R2.1）。这是因为插件 TUI 斜杠命令
 *   的 `onSelect` 不接收参数、且无法承接「命令尾随文本」（尾随文本会被 OpenCode 当普通对话
 *   发给模型），故运行参数必须经 TUI 内对话框收集。
 * - **运行态过滤**：{@link filterRunsForCommand} 为纯函数，按命令语义筛选 Run_Selector
 *   候选（resume→非 running、cancel→running|paused、pause→running、delete→非 running，R2.5）。
 * - **完整 runId 作选项值**：Run_Selector 的 `DialogSelect` 选项 `value` 用**完整 runId**，
 *   规避前缀歧义（R2.9）；选项标题显示 `<状态图标> <name> [<status>] <耗时>`。
 * - **破坏性二次确认**：`cancel`/`delete` 经 `DialogConfirm` 二次确认；`pause`/`resume`
 *   不确认直达（R2.6）。
 * - **反馈**：写操作完成经 `api.ui.toast` 反馈（成功含 runId、失败含错误原因，R2.7）；
 *   并经 {@link WorkflowCommandsDeps.notify} 向主 session 注入一条**不触发 LLM** 的运行态
 *   提示消息（`session.promptAsync({ noReply:true })`，home 页无 session 时自动新建），
 *   随后跳转 monitor 全屏运行界面，让用户在运行界面直观看到结果。
 * - **对话框收尾**：所有「选完/填完直接执行写操作」的命令在动作前 `stack.clear()` 关闭
 *   对话框（DialogSelect/DialogPrompt 的 onSelect/onConfirm 不会自动关闭，需显式收尾）。
 * - **空态**：过滤后无候选时显示空态提示并允许 Esc 退出，不报错（R2.8）。
 * - **绝不抛未捕获异常**：所有命令回调与对话框回调包 try/catch，失败经 toast 呈现，
 *   绝不向上抛（Issue #13461：TUI hook 抛异常致黑屏）。
 *
 * 本模块**不写 JSX 语法**：`DialogSelect`/`DialogConfirm` 经 `api.ui` 注入的工厂函数
 * 以函数调用形式产出 `JSX.Element`，再交由对话框栈 `dialog.replace(() => element)` 渲染。
 *
 * @see ../../.kiro/specs/workflow-command-control/design.md — 6. TUI 命令注册与交互
 * Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9
 */

import type { TuiCommand, TuiPluginApi } from "@opencode-ai/plugin/tui"

import type { RunSnapshot, RunStatus } from "../types"
import type { WorkflowEngine } from "../engine/workflow-engine"
import type { WorkflowRegistryEntry } from "../extension/extension-system"
import { isWorkflowError } from "../errors"
import { formatDuration } from "./monitor-data"
import { sortRunsForDisplay } from "./panel-data"

// ============================================================================
// 依赖契约
// ============================================================================

/**
 * 命令交互所需的 `api.ui` 子集（仅声明本模块消费的成员）。
 *
 * 用 `TuiPluginApi["ui"][...]` 索引访问保证与真实 `api.ui` **类型完全一致**——尤其
 * `dialog.replace(render)` 期望的 `JSX.Element` 与 `DialogSelect`/`DialogConfirm` 的
 * 返回类型严格对齐，避免在无 JSX 的 `.ts` 文件里手写 JSX 类型。
 */
export interface WorkflowCommandsUi {
  /** 对话框栈：`replace(() => element)` 渲染弹框，`clear()` 关闭。 */
  dialog: TuiPluginApi["ui"]["dialog"]
  /** Run/Workflow 选择器工厂（函数调用产出元素，规避 JSX 语法）。 */
  DialogSelect: TuiPluginApi["ui"]["DialogSelect"]
  /** 破坏性操作二次确认工厂。 */
  DialogConfirm: TuiPluginApi["ui"]["DialogConfirm"]
  /** 文本输入工厂（`/workflows-run` 选定 workflow 后收集需求/提示词作为 args）。 */
  DialogPrompt: TuiPluginApi["ui"]["DialogPrompt"]
  /** 结果反馈。 */
  toast: TuiPluginApi["ui"]["toast"]
}

/**
 * {@link registerWorkflowCommands} 依赖（注入式，便于测试）。
 *
 * 由 `tui.tsx` 在装配 E_tui 后构造并注入：`engine` 为唯一执行引擎，`discover`/`readRuns`
 * 为读端口（沿用 tui.tsx 的 discover/readAllSnapshots），`ui` 为 `api.ui` 子集，
 * `navigateMonitor` 导航到 monitor 全屏路由（可带 runId 直达某 run 详情）。
 */
export interface WorkflowCommandsDeps {
  /** 唯一 Workflow 执行引擎 E_tui。 */
  engine: WorkflowEngine
  /** 发现可用 workflow（内置 + 用户自定义）。 */
  discover: () => Promise<WorkflowRegistryEntry[]>
  /** 读取全部 run 快照（复用 tui.tsx 的 readAllSnapshots）。 */
  readRuns: () => Promise<RunSnapshot[]>
  /** `api.ui` 子集（dialog/toast/对话框工厂）。 */
  ui: WorkflowCommandsUi
  /** 导航到 monitor 全屏路由；传 runId 时直达该 run 详情。 */
  navigateMonitor: (runId?: string) => void
  /**
   * 导航到 Workflow Studio 全屏路由（`workflow-studio`）。
   *
   * `/workflows-studio` 的唯一入口：进入后先选「意图」（浏览 / 新建 / 改配置 / 改结构 / 删除），
   * 再按意图选目标 workflow（新建除外），最后进入浏览详情 / 删除确认 / 向导。原先分散的
   * `list`/`create`/`config`/`edit` 四条命令统一收敛至此（见 docs/WF-Studio统一与命令收敛方案.md）。
   *
   * 真实实现由 `tui.tsx` 注入（复刻 navigateMonitor 的来源路由模式，记录来源后
   * `api.route.navigate(STUDIO_ROUTE)`，便于向导 Esc/完成后精确返回来源路由）。
   */
  navigateStudio: () => void
  /**
   * 运行态反馈：写操作成功后向主 session 注入**不触发 LLM** 的提示消息并跳转 monitor 全屏。
   * 实现注入「确保 session + promptAsync(noReply) + 跳转」三步逻辑（见 tui.tsx）；失败自吞，
   * 绝不向上抛（Issue #13461）。命令层在动作成功后 fire-and-forget 调用。
   */
  notify: (feedback: WorkflowActionFeedback) => Promise<void>
  /**
   * 启动「对话式创建 workflow」：向主 session 注入一条**触发模型回复**的消息，
   * 让模型用 `workflow-create` 工具（server plugin 注册）引导用户完成创建。
   *
   * 与 {@link notify}（`noReply:true`，仅展示不跑模型）相反——本端口必须**触发模型**，
   * 因为创建流程是模型主导的多轮对话。实现（tui.tsx 注入）：确保 session →
   * `promptAsync`（不带 noReply）→ 导航到该 session。失败自吞，不向上抛（Issue #13461）。
   *
   * @param requirement 用户在 DialogPrompt 输入的需求文本（非空）。
   */
  startCreate: (requirement: string) => Promise<void>
  /**
   * 把生成的脚本写入全局目录 `~/.opencode-workflows/`，返回写入的绝对路径。
   *
   * **保留依赖**：自类型创建/编辑改为 `/workflows-studio` 全屏向导后，实际落盘改由 Studio
   * 在 SUBMIT 时调用（见 create-screen.tsx）；命令层不再直接消费该端口。保留此字段以维持
   * 注入契约稳定（tui.tsx 仍注入同实现，亦供全屏向导端口复用），避免破坏既有装配与测试。
   *
   * 契约（真实实现由 tui.tsx 注入）：
   * - 写入全局目录（`resolveGlobalDir()`），内部 `mkdir -p` 确保目录存在；
   * - `fileName` 为 `<name>.mjs`；
   * - 返回写入的**绝对路径**；
   * - **失败不留残留**：先写临时文件再原子 rename，失败清理临时文件并以 reject 报错。
   */
  writeUserWorkflow: (fileName: string, content: string) => Promise<string>
}

/** Run_Selector 过滤语义对应的命令。 */
export type RunSelectorCommand = "status" | "resume" | "cancel" | "pause" | "delete"

/** 写操作类型（用于运行态反馈消息的措辞与跳转决策）。`status` 为只读查询（注入详情、不跳转）。 */
export type WorkflowActionKind = "run" | "pause" | "resume" | "cancel" | "delete" | "status"

/**
 * 运行态反馈描述：向主 session 注入「不触发 LLM」的提示消息所需信息。
 *
 * 由命令层在写操作**成功后**（或 `status` 查询完成后）构造并交给
 * {@link WorkflowCommandsDeps.notify}。notify 负责三件事（实现在 `tui.tsx`，便于本模块测试）：
 * ① 确保存在目标 session（home 页无 session 时新建）；② 经
 * `session.promptAsync({ noReply:true })` 注入消息（写入对话流、落盘、TUI 渲染，但不跑模型）；
 * ③ 按 `navigate` 决定是否跳转 monitor 全屏运行界面。
 */
export interface WorkflowActionFeedback {
  /** 写操作类型。 */
  kind: WorkflowActionKind
  /** 目标 workflow 名（run 时为所选 workflow；运行态控制类可省略）。 */
  workflowName?: string
  /** 关联 runId（run 为新建 runId；pause/resume/cancel/delete/status 为目标 runId）。 */
  runId?: string
  /** 本次运行的需求摘要（仅 run，用户输入的 feature）。 */
  feature?: string
  /** run 状态（仅 status：completed/failed/running/...）。 */
  status?: RunStatus
  /** agent 数（仅 status）。 */
  agentCount?: number
  /** 累计 token（仅 status）。 */
  totalTokens?: number
  /** 耗时文本（仅 status，已格式化）。 */
  durationText?: string
  /** 错误描述（仅 status 且 run 失败时）。 */
  error?: string
  /**
   * 注入反馈后是否跳转 monitor 全屏运行界面。缺省（undefined）视为 `true`。
   * `delete` 与 `status` 设为 `false`：无运行界面可看（delete 产物已删；status 仅查看详情）。
   */
  navigate?: boolean
  /**
   * 反馈来源为 monitor 全屏按键（p/r/x/d，经 notifyControl）时为 `true`：用户已在全屏
   * 监控界面，引导文案不用「进度已切换到全屏监控界面」措辞（缺省 undefined 为命令路径）。
   */
  fromMonitor?: boolean
}

// ============================================================================
// 纯函数：Run_Selector 过滤（Property 8，R2.5）
// ============================================================================

/**
 * 按命令语义过滤 Run_Selector 候选（**纯函数**，不修改入参）：
 *
 * - `status` → 全部 run；
 * - `resume` → 非 running/pausing（paused/failed/cancelled/completed）；
 * - `cancel` → running | pausing | paused；
 * - `pause`  → running；
 * - `delete` → 非 running/pausing。
 *
 * 注（FIX-1）：`pausing`（暂停途中，仍持有活动执行体）此刻不可 resume/delete——应让其先落到
 * `paused` 终态再操作；但可 cancel（级联 abort）。`pause` 仅放行 running，避免对暂停途中的 run
 * 重复发暂停信号。
 *
 * @param runs 全部 run 快照。
 * @param cmd  目标命令。
 * @returns 过滤后的新数组（保持入参顺序）。
 *
 * **Validates: Requirements 2.5**
 */
export function filterRunsForCommand(runs: RunSnapshot[], cmd: RunSelectorCommand): RunSnapshot[] {
  switch (cmd) {
    case "status":
      return [...runs]
    case "resume":
      return runs.filter((r) => r.status !== "running" && r.status !== "pausing")
    case "cancel":
      return runs.filter(
        (r) => r.status === "running" || r.status === "pausing" || r.status === "paused",
      )
    case "pause":
      return runs.filter((r) => r.status === "running")
    case "delete":
      return runs.filter((r) => r.status !== "running" && r.status !== "pausing")
  }
}

// ============================================================================
// 纯函数：状态图标 / 耗时 / 选项标题
// ============================================================================

/**
 * run 状态图标（覆盖全部 6 态，含非终态 `paused` 和过渡态 `pausing`）。
 */
export function runStatusIcon(status: RunStatus): string {
  switch (status) {
    case "running":
      return "▶"
    case "completed":
      return "✔"
    case "failed":
      return "✗"
    case "cancelled":
      return "■"
    case "paused":
      return "⏸"
    case "pausing":
      return "⏯"
  }
}

/**
 * 估算 run 耗时（ms）：已落 `durationMs` 直接用；否则以 `startTime` 起算
 * （running/paused 未结束时以「现在」为终点估算，便于选择器展示进行中时长）。
 */
export function elapsedMs(run: RunSnapshot, now: number = Date.now()): number | null {
  if (typeof run.durationMs === "number") return run.durationMs
  if (typeof run.startTime === "number") {
    const end = typeof run.endTime === "number" ? run.endTime : now
    return Math.max(0, end - run.startTime)
  }
  return null
}

/** Run_Selector 选项标题：`<图标> <name> [<status>] <耗时>`。 */
export function runOptionTitle(run: RunSnapshot): string {
  return `${runStatusIcon(run.status)} ${run.workflowName} [${run.status}] ${formatDuration(elapsedMs(run))}`
}

/** runId 短前缀（仅用于 description 展示，便于人眼区分；选项 value 仍用完整 runId）。 */
function shortId(runId: string): string {
  return runId.length > 8 ? runId.slice(0, 8) : runId
}

// ============================================================================
// 纯函数：运行态反馈消息文本（注入主 session，便于测试）
// ============================================================================

/** 写操作的人类可读动作名（用于反馈消息标题）。 */
function actionTitle(kind: WorkflowActionKind): string {
  switch (kind) {
    case "run":
      return "已启动 Workflow"
    case "pause":
      return "已暂停 Workflow"
    case "resume":
      return "已恢复 Workflow"
    case "cancel":
      return "已终止 Workflow"
    case "delete":
      return "已删除 Workflow 产物"
    case "status":
      return "Workflow 状态"
  }
}

/**
 * 构造注入主 session 的运行态反馈消息（**纯函数**）。
 *
 * 文本面向用户、信息适度：动作 + workflow 名 + runId + 需求摘要（run）+ 查看引导。
 * 需求摘要过长时截断（保留前 120 字），避免单条消息过长。该消息经
 * `session.promptAsync({ noReply:true })` 注入——写入对话流但不触发 LLM。
 *
 * @param fb 运行态反馈描述。
 * @returns 注入用的纯文本消息。
 */
export function buildActionMessage(fb: WorkflowActionFeedback): string {
  const lines: string[] = []
  const name = fb.workflowName ? `「${fb.workflowName}」` : ""

  // status：只读查询，注入完整状态详情（不含「已切换全屏」引导）。
  if (fb.kind === "status") {
    const icon = fb.status ? `${runStatusIcon(fb.status)} ` : "📋 "
    lines.push(`${icon}${actionTitle(fb.kind)}${name}${fb.status ? ` [${fb.status}]` : ""}`)
    if (fb.runId) lines.push(`runId: ${fb.runId}`)
    const metrics: string[] = []
    if (typeof fb.agentCount === "number") metrics.push(`agents ${fb.agentCount}`)
    if (typeof fb.totalTokens === "number") metrics.push(`tokens ${fb.totalTokens}`)
    if (fb.durationText) metrics.push(`耗时 ${fb.durationText}`)
    if (metrics.length > 0) lines.push(metrics.join(" · "))
    if (fb.error) lines.push(`错误: ${fb.error}`)
    lines.push("详情可在右侧 Sidebar 或 /workflows-monitor 查看。")
    return lines.join("\n")
  }

  lines.push(`✅ ${actionTitle(fb.kind)}${name}`)
  if (fb.runId) lines.push(`runId: ${fb.runId}`)
  if (fb.kind === "run" && fb.feature) {
    const trimmed = fb.feature.length > 120 ? `${fb.feature.slice(0, 120)}…` : fb.feature
    lines.push(`需求: ${trimmed}`)
  }
  // monitor 按键路径（fromMonitor）：用户已在全屏监控界面，不用「已切换」措辞。
  // delete 不跳转全屏（navigate:false），引导措辞相应调整。
  if (fb.fromMonitor) {
    lines.push("详情可在右侧 Sidebar 或 /workflows-monitor 查看。")
  } else if (fb.navigate === false) {
    lines.push("可在右侧 Sidebar 或 /workflows-monitor 查看其余运行。")
  } else {
    lines.push("进度已切换到全屏监控界面；也可在右侧 Sidebar 或 /workflows-monitor 查看。")
  }
  return lines.join("\n")
}

// ============================================================================
// 类型详情文本：已迁至 studio-types.ts（Studio 浏览模式与命令层共用），此处 re-export 兼容既有引用。
// ============================================================================

export { sourceLabel, buildTypeDetail } from "./studio-types"

/**
 * 构造「对话式创建 workflow」的触发消息（**纯函数**），由 startCreate 注入主 session 触发模型。
 *
 * 消息明确指示模型用 `workflow-create` 工具（server plugin 注册，其 Tool Description 承载
 * 完整生成规范）引导用户完成创建——先对话收集信息，遵循工具说明生成并自检脚本，最后调用工具落盘。
 *
 * @param requirement 用户在 DialogPrompt 输入的需求文本。
 */
export function buildCreateTriggerMessage(requirement: string): string {
  const req = String(requirement ?? "").trim()
  return [
    "用户想创建一个自定义 workflow。需求如下：",
    "",
    req,
    "",
    "请使用 `workflow-create` 工具引导用户完成创建：先通过多轮对话收集必要信息" +
      "（名称、描述、是否详细规划，详细规划时逐项确认阶段/资源/门控轮次/产出），" +
      "遵循该工具说明书生成符合契约的 .mjs 与 config.json，自检后调用 `workflow-create` 工具落盘。" +
      "若工具返回契约违约，据其修正后重新调用（最多 3 轮）。",
  ].join("\n")
}

// ============================================================================
// 命令注册
// ============================================================================

/** Workflow 命令面板分类。 */
const CATEGORY = "Workflow"

/**
 * 注册 7 条 `/workflows-*` 斜杠命令（+ `wf-*` 别名），极简直达交互。
 *
 * 含 `/workflows-studio`（别名 `wf-studio`，导航进入 Workflow Studio 全屏意图菜单——
 * workflow 类型的浏览/新建/改配置/改结构/删除统一入口）与 run 实例命令
 * （run / monitor / resume / pause / cancel / delete）。
 *
 * 所有命令回调与对话框回调均包 try/catch，失败经 toast 呈现，绝不向上抛
 * （Issue #13461）。
 *
 * @param api  TUI 插件 API（用其 `command.register` 注册命令）。
 * @param deps 注入依赖（engine/discover/readRuns/ui/navigateMonitor/navigateStudio/notify/writeUserWorkflow）。
 *
 * Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 13.1, 17.5
 */
export function registerWorkflowCommands(api: TuiPluginApi, deps: WorkflowCommandsDeps): void {
  const ui = deps.ui

  /**
   * 先回收孤儿 run（心跳停滞的 `running` → `failed`）再读取全部 run（修复 A）。
   *
   * 中断的 run（如 opencode 进程退出）会卡在 `status="running"`，而状态相关的选择器
   * （resume 排除 running / cancel·pause 只取 running·paused / delete 排除 running）依赖准确状态。
   * 装配时的 `recoverOrphans()` 是 fire-and-forget，不保证在用户打开选择器前完成回收；故此处在
   * 列举前**显式 await 一次回收**，使中断的 run 立即变为可见/可恢复。回收 best-effort，失败不阻塞列举。
   */
  async function readRunsReclaimed(): Promise<RunSnapshot[]> {
    try {
      await deps.engine.recoverOrphans()
    } catch {
      // 回收失败（如读盘异常）不阻塞列举：退化为仅读取当前快照。
    }
    return deps.readRuns()
  }

  /** 提取错误消息（WorkflowError 带 `[CODE]`；其余兜底 String 化）。 */
  function errorMessage(e: unknown): string {
    if (isWorkflowError(e)) return e.message
    if (e instanceof Error) return e.message
    return String(e)
  }

  /**
   * 成功/失败 toast 包装：执行写操作 fn，按结果反馈（成功含 runId）。
   *
   * @param label    toast 标题。
   * @param fn       写操作（返回 runId 字符串或 void）。
   * @param feedback 成功后构造运行态反馈描述（接收 fn 返回的 runId）；返回 null 则不注入。
   *                 用于 run/pause/resume/cancel/delete 成功后向主 session 注入提示并跳转
   *                 monitor 全屏。注入为 fire-and-forget，失败由 notify 内部自吞。
   */
  async function runAction(
    label: string,
    fn: () => Promise<string | void>,
    feedback?: (runId: string | undefined) => WorkflowActionFeedback | null,
  ): Promise<void> {
    try {
      const runId = await fn()
      ui.toast({
        variant: "success",
        title: label,
        message: typeof runId === "string" && runId.length > 0 ? `成功：${runId}` : "成功",
      })
      if (feedback) {
        const fb = feedback(typeof runId === "string" ? runId : undefined)
        if (fb) void deps.notify(fb).catch(() => {})
      }
    } catch (e) {
      ui.toast({ variant: "error", title: label, message: errorMessage(e) })
    }
  }

  /** 当前对话框栈：优先用命令回调传入的栈，回退到 `ui.dialog`。 */
  function stackOf(dialogArg: WorkflowCommandsUi["dialog"] | undefined): WorkflowCommandsUi["dialog"] {
    return dialogArg ?? ui.dialog
  }

  /**
   * 展示空态提示（无候选）：单个 disabled 选项，允许 Esc 退出，不报错（R2.8）。
   * FIX-10: placeholder 统一提示文案（↑↓ Esc）。
   */
  function showEmptyState(stack: WorkflowCommandsUi["dialog"], title: string): void {
    stack.replace(() =>
      ui.DialogSelect<string>({
        title,
        placeholder: "↑↓ 选择，Esc 退出（无符合条件的 run）",
        options: [{ title: "（无符合条件的 run）", value: "", disabled: true }],
      }),
    )
  }

  /**
   * 展示 Run_Selector（DialogSelect）：选项 value 用**完整 runId**（R2.9），
   * 标题 `<图标> <name> [<status>] <耗时>`；选中后回调 onPick(完整 runId)。
   * 候选为空时退化为空态提示。
   */
  function showRunSelector(
    stack: WorkflowCommandsUi["dialog"],
    title: string,
    runs: RunSnapshot[],
    onPick: (runId: string) => void,
  ): void {
    if (runs.length === 0) {
      showEmptyState(stack, title)
      return
    }
    const sorted = sortRunsForDisplay(runs, 0)
    stack.replace(() =>
      ui.DialogSelect<string>({
        title,
        placeholder: "↑↓ 选择 run，Enter 确认，Esc 取消",
        options: sorted.map((r) => ({
          title: runOptionTitle(r),
          value: r.runId,
          description: shortId(r.runId),
        })),
        onSelect: (option) => {
          try {
            if (option.value) onPick(option.value)
          } catch (e) {
            ui.toast({ variant: "error", title, message: errorMessage(e) })
          }
        },
      }),
    )
  }

  /**
   * 破坏性操作二次确认（cancel/delete，R2.6）：确认后执行 onConfirm，取消则关闭。
   */
  function showConfirm(
    stack: WorkflowCommandsUi["dialog"],
    title: string,
    message: string,
    onConfirm: () => void,
  ): void {
    stack.replace(() =>
      ui.DialogConfirm({
        title,
        message,
        onConfirm: () => {
          try {
            onConfirm()
          } catch (e) {
            ui.toast({ variant: "error", title, message: errorMessage(e) })
          }
        },
        onCancel: () => stack.clear(),
      }),
    )
  }

  // ----- /workflows-run：选 workflow → 收集需求/提示词 → execute(name, args) + toast（R2.1） -----
  //
  // 两步交互（解决「斜杠命令无法在输入框尾随提示词」的限制，见 design.md「命令交互」）：
  //   1. DialogSelect 选定要运行的 workflow（内置 + 用户自定义）；
  //   2. DialogPrompt 收集本次运行的需求/提示词（如「读取 C:/需求文档.md 作为需求进行开发」），
  //      作为 `args.feature` 注入 workflow（prd/code/design/test 均消费 `ctx.args.feature`）。
  //
  // 为何需要第 2 步：插件经 `api.command.register({ slash })` 注册的 TUI 命令只能从自动补全
  // 列表选中触发（`command.trigger`），其 `onSelect` 不接收参数；用户在 `/workflows-run` 后
  // 直接敲文本会被 OpenCode 当作普通对话发给模型（命令不匹配 server 端命令表）。因此运行参数
  // 必须经 TUI 内对话框收集，而非命令尾随文本。
  async function handleRun(stack: WorkflowCommandsUi["dialog"]): Promise<void> {
    const entries = await deps.discover()
    if (entries.length === 0) {
      stack.replace(() =>
        ui.DialogSelect<string>({
          title: "运行 Workflow",
          placeholder: "↑↓ 选择 workflow，Esc 退出",
          options: [{ title: "（未发现可用 workflow）", value: "", disabled: true }],
        }),
      )
      return
    }
    stack.replace(() =>
      ui.DialogSelect<string>({
        title: "运行 Workflow",
        placeholder: "↑↓ 选择 workflow，Enter 确认，Esc 取消",
        options: entries.map((e) => ({
          title: `${e.name}${e.source === "user" ? " (user)" : ""}`,
          value: e.name,
          description: e.whenToUse ?? e.description,
        })),
        onSelect: (option) => {
          try {
            if (!option.value) return
            promptForArgsAndRun(stack, option.value)
          } catch (e) {
            ui.toast({ variant: "error", title: "运行 Workflow", message: errorMessage(e) })
          }
        },
      }),
    )
  }

  /**
   * 第 2 步：弹 DialogPrompt 收集本次运行的需求/提示词，作为 `args.feature` 执行 workflow。
   *
   * - 提交后先 `stack.clear()` 关闭输入对话框（DialogPrompt 的 onConfirm 不会自动关闭）；
   * - 输入留空时以 `undefined` args 执行（workflow 内部回退到「当前需求」等默认值），不报错；
   * - 输入文本作为 `args.feature` 注入（如直接粘贴需求文档路径或自然语言描述）；
   * - 启动成功后经 {@link WorkflowCommandsDeps.notify} 向主 session 注入运行态提示并跳转
   *   monitor 全屏；
   * - 取消（Esc）则关闭对话框、不执行（R2.8 同源的「可退出不报错」）。
   *
   * FIX-10: placeholder 加操作提示（可留空/粘贴路径）。
   */
  function promptForArgsAndRun(stack: WorkflowCommandsUi["dialog"], workflowName: string): void {
    stack.replace(() =>
      ui.DialogPrompt({
        title: `运行 Workflow · ${workflowName}`,
        description: undefined,
        placeholder: "输入本次需求（可留空使用默认；可直接粘贴需求文档路径或需求文本；Enter 确认）",
        onConfirm: (value) => {
          try {
            stack.clear() // 关闭输入对话框（DialogPrompt onConfirm 不自动关闭）。
            const feature = typeof value === "string" ? value.trim() : ""
            const args = feature.length > 0 ? { feature } : undefined
            void runAction(
              "运行 Workflow",
              () => deps.engine.execute(workflowName, args),
              (runId) => ({ kind: "run", workflowName, runId, feature: feature || undefined }),
            )
          } catch (e) {
            ui.toast({ variant: "error", title: "运行 Workflow", message: errorMessage(e) })
          }
        },
        onCancel: () => stack.clear(),
      }),
    )
  }

  // ----- /workflows-create：收集需求 → startCreate 触发模型用 workflow-create 工具引导创建 -----
  //
  // 与 run 同源的「斜杠命令无法尾随参数」限制：用 DialogPrompt 收集需求文本，提交后经
  // deps.startCreate 向主 session 注入一条**触发模型回复**的消息（模型据此调用 server plugin
  // 注册的 workflow-create 工具，进入多轮对话式创建）。空需求不触发（仅关闭对话框）。
  // FIX-10: placeholder 加操作提示（Enter 确认）。
  function handleCreate(stack: WorkflowCommandsUi["dialog"]): void {
    stack.replace(() =>
      ui.DialogPrompt({
        title: "创建 Workflow",
        description: undefined,
        placeholder: "用一句话描述想要的 workflow（如：从需求到概要/详细设计再到 TDD 代码；Enter 确认）",
        onConfirm: (value) => {
          try {
            stack.clear() // 关闭输入对话框（DialogPrompt onConfirm 不自动关闭）。
            const requirement = typeof value === "string" ? value.trim() : ""
            if (requirement.length === 0) return // 空需求不触发。
            void deps.startCreate(requirement).catch((e) =>
              ui.toast({ variant: "error", title: "创建 Workflow", message: errorMessage(e) }),
            )
          } catch (e) {
            ui.toast({ variant: "error", title: "创建 Workflow", message: errorMessage(e) })
          }
        },
        onCancel: () => stack.clear(),
      }),
    )
  }
  async function handleResume(stack: WorkflowCommandsUi["dialog"]): Promise<void> {
    const runs = filterRunsForCommand(await readRunsReclaimed(), "resume")
    showRunSelector(stack, "恢复 Workflow（resume）", runs, (runId) => {
      stack.clear() // 关闭选择器（DialogSelect onSelect 不自动关闭）。
      void runAction(
        "恢复 Workflow",
        () => deps.engine.resume(runId),
        () => ({ kind: "resume", runId }),
      )
    })
  }

  // ----- /workflows-pause：选 running → pause（不确认，R2.6） -----
  async function handlePause(stack: WorkflowCommandsUi["dialog"]): Promise<void> {
    const runs = filterRunsForCommand(await readRunsReclaimed(), "pause")
    showRunSelector(stack, "暂停 Workflow（pause）", runs, (runId) => {
      stack.clear() // 关闭选择器（DialogSelect onSelect 不自动关闭）。
      void runAction(
        "暂停 Workflow",
        () => deps.engine.pause(runId),
        () => ({ kind: "pause", runId }),
      )
    })
  }

  // ----- /workflows-cancel：选 running|paused → 确认 → cancel（R2.6） -----
  async function handleCancel(stack: WorkflowCommandsUi["dialog"]): Promise<void> {
    const runs = filterRunsForCommand(await readRunsReclaimed(), "cancel")
    showRunSelector(stack, "终止 Workflow（cancel）", runs, (runId) => {
      showConfirm(stack, "终止 Workflow", `确认终止 run ${shortId(runId)}？此操作不可撤销。`, () => {
        void runAction(
          "终止 Workflow",
          () => deps.engine.cancel(runId),
          () => ({ kind: "cancel", runId }),
        )
      })
    })
  }

  // ----- /workflows-delete：选非 running → 确认 → delete（R2.6） -----
  async function handleDelete(stack: WorkflowCommandsUi["dialog"]): Promise<void> {
    const runs = filterRunsForCommand(await readRunsReclaimed(), "delete")
    showRunSelector(stack, "删除 Workflow 产物（delete）", runs, (runId) => {
      showConfirm(
        stack,
        "删除 Workflow 产物",
        `确认删除该次运行（run ${shortId(runId)}）的产物（运行快照 / 执行日志 / 脚本运行副本）？\n` +
          `此操作仅清理这一次运行记录，不影响 workflow 类型定义本身。不可撤销。`,
        () => {
          void runAction(
            "删除 Workflow 产物",
            () => deps.engine.delete(runId),
            () => ({ kind: "delete", runId, navigate: false }),
          )
        },
      )
    })
  }

  /** 包裹命令回调：捕获同步/异步异常并 toast，绝不向上抛（Issue #13461）。 */
  function guard(label: string, handler: (stack: WorkflowCommandsUi["dialog"]) => Promise<void> | void) {
    return (dialogArg?: WorkflowCommandsUi["dialog"]): void => {
      try {
        const r = handler(stackOf(dialogArg))
        if (r instanceof Promise) r.catch((e) => ui.toast({ variant: "error", title: label, message: errorMessage(e) }))
      } catch (e) {
        ui.toast({ variant: "error", title: label, message: errorMessage(e) })
      }
    }
  }

  const commands: TuiCommand[] = [
    {
      title: "Workflows: Run",
      value: "workflows.run",
      category: CATEGORY,
      slash: { name: "workflows-run", aliases: ["wf-run"] },
      onSelect: guard("运行 Workflow", handleRun),
    },
    {
      title: "Workflows: Studio",
      value: "workflows.studio",
      category: CATEGORY,
      slash: { name: "workflows-studio", aliases: ["wf-studio"] },
      onSelect: guard("Workflow Studio", () => deps.navigateStudio()),
    },
    {
      title: "Workflows: Create",
      value: "workflows.create",
      category: CATEGORY,
      slash: { name: "workflows-create", aliases: ["wf-create"] },
      onSelect: guard("创建 Workflow", handleCreate),
    },
    {
      title: "Workflows: Resume",
      value: "workflows.resume",
      category: CATEGORY,
      slash: { name: "workflows-resume", aliases: ["wf-resume"] },
      onSelect: guard("恢复 Workflow", handleResume),
    },
    {
      title: "Workflows: Cancel",
      value: "workflows.cancel",
      category: CATEGORY,
      slash: { name: "workflows-cancel", aliases: ["wf-cancel"] },
      onSelect: guard("终止 Workflow", handleCancel),
    },
    {
      title: "Workflows: Pause",
      value: "workflows.pause",
      category: CATEGORY,
      slash: { name: "workflows-pause", aliases: ["wf-pause"] },
      onSelect: guard("暂停 Workflow", handlePause),
    },
    {
      title: "Workflows: Delete",
      value: "workflows.delete",
      category: CATEGORY,
      slash: { name: "workflows-delete", aliases: ["wf-delete"] },
      onSelect: guard("删除 Workflow 产物", handleDelete),
    },
    {
      title: "Workflows: Monitor",
      value: "workflows.monitor",
      category: CATEGORY,
      slash: { name: "workflows-monitor", aliases: ["wf-monitor"] },
      onSelect: guard("打开 Monitor", () => {
        deps.navigateMonitor()
      }),
    },
  ]

  api.command?.register(() => commands)
}
