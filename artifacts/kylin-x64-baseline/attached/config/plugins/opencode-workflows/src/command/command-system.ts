/**
 * OpenCode Workflows —— Command_System（命令解析与分发）。
 *
 * 单入口收敛后（spec: workflow-command-control，R3.1/R3.2），Command_System 仅保留
 * **用户显式发起**路径所需的纯逻辑：
 *
 * 1. `/workflow` 命令解析与分发（list/run/resume/status/cancel）：{@link createCommandSystem}
 *    的 `handleCommand` 解析子命令与参数并分发到 WorkflowEngine，按命令清单组织输出字段集合。
 *    供 TUI 命令层与测试复用（生产入口为 TUI 斜杠命令直接调用 engine）。
 * 2. **受控目录路径校验（R3.3/R3.4，纵深防御）**：{@link resolveWorkflowArg} /
 *    {@link isPathInControlledDir} 把解析为 workflow 的目标限定为**已注册 name** 或**受控目录**
 *    内脚本，越界抛 `PATH_NOT_ALLOWED`（含 `..` 逃逸防护）。受控目录白名单为**绝对路径数组**
 *    （内置 workflows 目录 + 全局用户目录 `~/.opencode-workflows`），由装配方注入。
 *
 * 已移除（R3.2）：agent 自主发起的 `run-workflow` 工具入口、面向用户的 `workflow` 工具，
 * 以及 opt-in 门控（`isOptInMessage`/`OPT_IN_KEYWORDS`/`noteChatMessage`/`hasOptIn`/
 * `registerOptInTracker`/`handleRunWorkflow`）。设计哲学：opencode-workflows 只跑已注册的
 * 合法 workflow，且由用户显式发起——用户敲斜杠命令本身即显式意图，无需 agent 工具入口与 opt-in 门控。
 *
 * @see .kiro/specs/workflow-command-control/design.md — 8. 入口装配 / command-system.ts
 * Requirements: 3.2, 3.3, 3.4
 */

import { isAbsolute, normalize, relative, resolve as resolvePath } from "node:path"

import { WorkflowError } from "../errors"
import type { RunSnapshot, RunStatus } from "../types"
import type { WorkflowEngine } from "../engine/workflow-engine"

// ============================================================================
// 受控目录与路径校验（R3.3/R3.4，纵深防御）
// ============================================================================

/**
 * 默认受控目录白名单（绝对路径数组）。
 *
 * 装配方（`index.ts`）须注入真实的「内置 workflows 目录绝对路径 + 全局用户目录
 * `~/.opencode-workflows` 绝对路径」。本常量仅作为未注入时的空白名单兜底（拒绝一切 path 目标，
 * 仅放行已注册 name），避免在缺省注入时误放行任何脚本路径。
 *
 * 注意：已移除项目级 `.opencode/workflows`——自定义 workflow 统一收敛到全局目录。
 */
export const CONTROLLED_DIRS: readonly string[] = []

/**
 * 判断 `path` 是否落在某个受控目录内（按**绝对路径白名单**判定，含 `..` 逃逸防护）。
 *
 * 与旧实现（以 cwd 为隐式基准拼相对目录）不同：受控目录现为**绝对路径数组**（内置目录与
 * 全局目录都不在项目 cwd 下，无法用相对目录表达）。判定步骤：先 `resolve` 目标 path 与每个
 * 受控目录为绝对路径，再用 `relative(controlled, target)` 判定包含关系——`rel === ""`（目标即
 * 受控目录本身）或 `rel` 不以 `..` 开头且非绝对路径（目标嵌套于受控目录下）即为受控。
 *
 * 空 path 返回 false；纯 `..` 逃逸、指向受控目录之外者返回 false。`relative` 在 Windows 跨盘符
 * 场景会返回绝对路径（如 `C:\..`），此时 `isAbsolute(rel)` 为真，判为不受控。
 *
 * @param path 待校验路径。
 * @param controlledDirs 受控目录**绝对路径**数组（内置目录 + 全局目录），默认空白名单。
 */
export function isPathInControlledDir(
  path: string,
  controlledDirs: readonly string[] = CONTROLLED_DIRS,
): boolean {
  if (typeof path !== "string" || path.length === 0) return false
  const target = resolvePath(path)
  for (const dir of controlledDirs) {
    const controlled = resolvePath(dir)
    const rel = relative(controlled, target)
    // 在目录内：relative 为空（即目录本身）或不以 .. 开头且非绝对路径（嵌套其下）。
    // 跨盘符（Windows）时 relative 返回绝对路径，isAbsolute(rel) 为真 → 判为不受控。
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
      return true
    }
  }
  return false
}

/**
 * 解析 workflow 目标参数为「已注册 name」或「受控目录 path」。
 *
 * @param workflow 入参字符串。
 * @param isRegisteredName 判定某字符串是否为已注册 workflow name。
 * @param controlledDirs 受控目录**绝对路径**数组（内置目录 + 全局目录），默认空白名单。
 * @returns `{ kind: "name" | "path", value }`。
 * @throws {WorkflowError} `PATH_NOT_ALLOWED` —— 非已注册 name 且 path 不在受控目录内。
 */
export function resolveWorkflowArg(
  workflow: string,
  isRegisteredName: (name: string) => boolean,
  controlledDirs: readonly string[] = CONTROLLED_DIRS,
): { kind: "name" | "path"; value: string } {
  if (isRegisteredName(workflow)) {
    return { kind: "name", value: workflow }
  }
  if (isPathInControlledDir(workflow, controlledDirs)) {
    return { kind: "path", value: normalize(workflow) }
  }
  throw new WorkflowError(
    "PATH_NOT_ALLOWED",
    `workflow "${workflow}" 既非已注册 name，其 path 也不在受控目录内（${controlledDirs.join(" / ") || "<空白名单>"}）`,
    { workflow, controlledDirs: [...controlledDirs] },
  )
}

// ============================================================================
// /workflow 命令解析（list/run/resume/status/cancel）
// ============================================================================

/** 解析后的 /workflow 命令。 */
export type ParsedCommand =
  | { sub: "list" }
  | { sub: "run"; workflow: string }
  | { sub: "resume"; runId: string }
  | { sub: "status"; runId: string }
  | { sub: "cancel"; runId: string }

/**
 * 解析 `/workflow` 命令参数串为结构化命令。
 *
 * 约定：无参数或 `list` → list；`run <name|path>`；`resume <runId>`；
 * `status <runId>`；`cancel <runId>`。无法识别抛 {@link WorkflowError}。
 *
 * @param argline `/workflow` 之后的参数串（已去除命令名）。
 */
export function parseWorkflowCommand(argline: string): ParsedCommand {
  const parts = argline.trim().split(/\s+/).filter((s) => s.length > 0)
  if (parts.length === 0 || parts[0] === "list") {
    return { sub: "list" }
  }
  const [sub, ...rest] = parts
  const arg = rest.join(" ").trim()
  switch (sub) {
    case "run":
      if (!arg) throw new WorkflowError("WORKFLOW_NOT_FOUND", "/workflow run 需要 <name|path> 参数", {})
      return { sub: "run", workflow: arg }
    case "resume":
      if (!arg) throw new WorkflowError("RESUME_INVALID", "/workflow resume 需要 <runId> 参数", {})
      return { sub: "resume", runId: arg }
    case "status":
      if (!arg) throw new WorkflowError("WORKFLOW_NOT_FOUND", "/workflow status 需要 <runId> 参数", {})
      return { sub: "status", runId: arg }
    case "cancel":
      if (!arg) throw new WorkflowError("RUN_NOT_CANCELLABLE", "/workflow cancel 需要 <runId> 参数", {})
      return { sub: "cancel", runId: arg }
    default:
      throw new WorkflowError(
        "WORKFLOW_NOT_FOUND",
        `未知 /workflow 子命令："${sub}"（支持 list/run/resume/status/cancel）`,
        { sub },
      )
  }
}

// ============================================================================
// runId 前缀解析（容忍模型截断的短 ID）
// ============================================================================

/**
 * runId 前缀解析结果。
 *
 * - `exact`：输入与某 run 的完整 runId 精确相等。
 * - `unique-prefix`：输入是唯一一个 run 的 runId 前缀（类 git/docker 短 SHA）。
 * - `ambiguous`：输入是多个 run 的共同前缀，需补全（携带候选完整 runId）。
 * - `not-found`：无任何 run 精确匹配或以输入为前缀。
 */
export type RunIdResolution =
  | { kind: "exact"; runId: string }
  | { kind: "unique-prefix"; runId: string }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "not-found" }

/**
 * 在已知 runId 集合中解析一个（可能被截断的）输入为完整 runId。
 *
 * 解析策略（与 git/docker 短 SHA 一致，优先精确）：
 * 1. **精确匹配优先**：输入等于某完整 runId → `exact`（即使它同时是更长 runId 的前缀，
 *    精确命中也优先，避免「完整 ID 恰好是另一 ID 前缀」时被误判歧义）。
 * 2. 否则收集所有以输入为前缀的 runId：唯一 → `unique-prefix`；多个 → `ambiguous`
 *    （candidates 升序，便于稳定提示）；零个 → `not-found`。
 *
 * 输入为空串时直接 `not-found`（不把空串当作匹配所有的前缀）。
 *
 * @param input 用户/模型给出的 runId 或其前缀。
 * @param knownRunIds 当前已知的全部完整 runId（来自 listRuns）。
 */
export function resolveRunId(input: string, knownRunIds: readonly string[]): RunIdResolution {
  if (typeof input !== "string" || input.length === 0) {
    return { kind: "not-found" }
  }
  // 精确匹配优先。
  if (knownRunIds.includes(input)) {
    return { kind: "exact", runId: input }
  }
  const matches = knownRunIds.filter((id) => id.startsWith(input))
  if (matches.length === 0) {
    return { kind: "not-found" }
  }
  if (matches.length === 1) {
    return { kind: "unique-prefix", runId: matches[0] }
  }
  return { kind: "ambiguous", candidates: [...matches].sort() }
}

// ============================================================================
// 斜杠命令误用检测（用户把 /workflows-* 当普通消息发出）
// ============================================================================

/**
 * 全部 workflow 斜杠命令名 + `wf-*` 别名（与 `src/tui/commands.ts` 注册清单一致）。
 *
 * 用于检测「用户把命令当普通对话发出」：正确用法经 TUI 补全列表选中触发（`command.trigger`），
 * 不经 `chat.message`；一旦命令文本经 `chat.message` 到达，即说明用户敲了「命令 + 空格 + 参数」
 * 导致补全面板关闭、整段被当对话提交（新源码 autocomplete 的「空格即关闭」规则）。
 */
export const WORKFLOW_SLASH_COMMANDS = [
  "workflows-run",
  "workflows-studio",
  "workflows-resume",
  "workflows-cancel",
  "workflows-pause",
  "workflows-delete",
  "workflows-monitor",
  "wf-run",
  "wf-studio",
  "wf-resume",
  "wf-cancel",
  "wf-pause",
  "wf-delete",
  "wf-monitor",
] as const

/** 误用检测结果：命中的命令名（不含 `/`）与其后的尾随参数文本（已 trim）。 */
export interface WorkflowCommandMisuse {
  command: string
  args: string
}

/**
 * 检测一段用户消息文本是否为「被误当对话发出的 workflow 斜杠命令」（**纯函数**）。
 *
 * 命中条件：trim 后以 `/` 开头，首个空白分隔 token（去掉前导 `/`）属于
 * {@link WORKFLOW_SLASH_COMMANDS}。命中返回 `{ command, args }`（args 为命令后的剩余文本，
 * 可为空串）；否则返回 null。
 *
 * 注意：正确用法（从补全列表选中命令）经 `command.trigger` 触发，**不会**产生 `chat.message`
 * 文本；故凡到达本检测的命令文本，一律视为误用，给出用法指引。
 *
 * @param text 用户消息的纯文本内容。
 */
export function detectWorkflowCommandMisuse(text: string): WorkflowCommandMisuse | null {
  if (typeof text !== "string") return null
  const trimmed = text.trim()
  if (!trimmed.startsWith("/")) return null
  const firstWsMatch = trimmed.match(/\s/)
  const firstTokenEnd = firstWsMatch?.index ?? trimmed.length
  const token = trimmed.slice(1, firstTokenEnd) // 去掉前导 "/"
  if (!(WORKFLOW_SLASH_COMMANDS as readonly string[]).includes(token)) return null
  const args = trimmed.slice(firstTokenEnd).trim()
  return { command: token, args }
}

/**
 * 为误用命令构造「指引指令」（**纯函数**），替换原始用户文本注入到该轮消息。
 *
 * 目的：把用户那句"命令+参数"替换为一段给模型的简短指令——让模型只回复**正确用法提示**，
 * 既避免模型对着 `/workflows-run 开发贪吃蛇` 自由发挥（瞎猜甚至真去执行），又把使用习惯纠偏。
 *
 * 指令本身强约束「只输出提示、不执行任何操作」，并据命令是否为 `run`（带参数语义）给出
 * 对应的两步操作指引。
 *
 * @param misuse 命中的命令与参数。
 */
export function buildWorkflowMisuseDirective(misuse: WorkflowCommandMisuse): string {
  const cmd = misuse.command
  const isRun = cmd === "workflows-run" || cmd === "wf-run"
  const lines = [
    `[opencode-workflows] 系统检测：用户输入 “/${cmd}${misuse.args ? " " + misuse.args : ""}” 试图调用 Workflow 斜杠命令，` +
      `但斜杠命令不能在后面直接接空格和参数（一旦输入空格，补全面板会关闭，整句被当作普通对话发送）。`,
    "",
    "请用简洁友好的中文**仅向用户复述以下正确用法提示**，不要执行任何其他操作、不要尝试运行 workflow、不要调用任何工具：",
    "",
    "正确用法：",
    `1. 单独输入 /${cmd}（或其 wf- 别名），**不要加空格和参数**；`,
    "2. 在弹出的补全列表中用 ↑/↓ 选中该命令并回车（或鼠标点选）；",
  ]
  if (isRun) {
    lines.push(
      "3. 在随后弹出的 workflow 选择框中选择要运行的 workflow；",
      "4. 在再弹出的输入框中填写本次需求/提示词（例如需求文档路径或自然语言描述），回车即可启动。",
    )
  } else {
    lines.push("3. 按弹出的对话框提示完成后续选择即可。")
  }
  return lines.join("\n")
}

// ============================================================================
// 输出字段集合（命令清单）
// ============================================================================

/** list 输出条目（runId、workflowName、status、startTime、durationMs）。 */
export interface ListEntry {
  runId: string
  workflowName: string
  status: RunStatus
  startTime: number
  durationMs: number | null
}

/** status 输出（字段集合）。 */
export interface StatusView {
  runId: string
  workflowName: string
  status: RunStatus
  startTime: number
  endTime: number | null
  durationMs: number | null
  agentCount: number
  totalTokens: number
  phases: RunSnapshot["phases"]
  workflowProgress: RunSnapshot["workflowProgress"]
  error: string | null
}

/** 从 Snapshot 投影 list 条目。 */
export function toListEntry(s: RunSnapshot): ListEntry {
  return {
    runId: s.runId,
    workflowName: s.workflowName,
    status: s.status,
    startTime: s.startTime,
    durationMs: s.durationMs,
  }
}

/** 从 Snapshot 投影 status 视图。 */
export function toStatusView(s: RunSnapshot): StatusView {
  return {
    runId: s.runId,
    workflowName: s.workflowName,
    status: s.status,
    startTime: s.startTime,
    endTime: s.endTime,
    durationMs: s.durationMs,
    agentCount: s.agentCount,
    totalTokens: s.totalTokens,
    phases: s.phases,
    workflowProgress: s.workflowProgress,
    error: s.error,
  }
}

// ============================================================================
// Command_System
// ============================================================================

/**
 * Command_System 公开接口。
 *
 * 单入口收敛后仅保留 `/workflow` 命令串处理器 {@link handleCommand}（供 TUI 命令层与测试
 * 复用）。原 run-workflow 工具注册、opt-in 追踪等 PluginApiPort 入口已随 R3.2 移除。
 */
export interface CommandSystem {
  /** 处理 /workflow 命令串，返回人类可读结果文本。 */
  handleCommand(argline: string, sessionID: string): Promise<string>
}

/** Command_System 依赖。 */
export interface CommandSystemDeps {
  engine: WorkflowEngine
  /** 判定某字符串是否为已注册 workflow name。 */
  isRegisteredName(name: string): boolean
  /**
   * 受控目录白名单（**绝对路径**数组：内置目录 + 全局目录），由装配方注入。
   * 未注入时退化为空白名单（仅放行已注册 name，拒绝一切 path 目标）。
   */
  controlledDirs?: readonly string[]
}

/**
 * 创建 Command_System。
 */
export function createCommandSystem(deps: CommandSystemDeps): CommandSystem {
  const controlledDirs = deps.controlledDirs ?? CONTROLLED_DIRS

  async function handleCommand(argline: string, _sessionID: string): Promise<string> {
    const cmd = parseWorkflowCommand(argline)

    /**
     * 把（可能被模型截断的）runId 前缀解析为完整 runId。
     * 命中 exact / unique-prefix 返回完整 runId；ambiguous/not-found 返回 null 并附人类可读消息。
     */
    async function resolveRunIdArg(
      input: string,
      action: string,
    ): Promise<{ runId: string } | { message: string }> {
      const runs = await deps.engine.listRuns(0)
      const res = resolveRunId(
        input,
        runs.map((r) => r.runId),
      )
      switch (res.kind) {
        case "exact":
        case "unique-prefix":
          return { runId: res.runId }
        case "ambiguous":
          return {
            message:
              `runId 前缀 "${input}" 匹配到多个运行记录，请补全后重试（${action}）：\n` +
              res.candidates.map((id) => `  ${id}`).join("\n"),
          }
        case "not-found":
          return { message: `未找到 runId=${input} 的运行记录` }
      }
    }

    switch (cmd.sub) {
      case "list": {
        const runs = await deps.engine.listRuns(50)
        const entries = runs.map(toListEntry)
        if (entries.length === 0) return "（暂无 workflow 运行记录）"
        const body = entries
          .map(
            (e) =>
              `${e.runId}  ${e.workflowName}  ${e.status}  start=${e.startTime}  dur=${e.durationMs ?? "-"}`,
          )
          .join("\n")
        // 内联提示（贴近使用点，降低模型截断 runId 概率，并引导不经模型的全屏监控）。
        return (
          `${body}\n\n` +
          `提示：runId 为完整 UUID，请原样展示、勿截断；status/resume/cancel 接受唯一前缀。` +
          `浏览/选择运行记录建议用 /workflow-monitor 全屏界面（直接读盘渲染，不经模型改写）。`
        )
      }
      case "run": {
        // 受控目录/已注册 name 校验（R3.3/R3.4，纵深防御）。
        const resolved = resolveWorkflowArg(cmd.workflow, deps.isRegisteredName, controlledDirs)
        const runId = await deps.engine.execute(resolved.value)
        return `已启动 workflow，runId=${runId}`
      }
      case "resume": {
        const r = await resolveRunIdArg(cmd.runId, "resume")
        if ("message" in r) return r.message
        const runId = await deps.engine.resume(r.runId)
        return `已恢复 workflow，runId=${runId}`
      }
      case "status": {
        const r = await resolveRunIdArg(cmd.runId, "status")
        if ("message" in r) return r.message
        const snapshot = await deps.engine.getRunStatus(r.runId)
        if (!snapshot) return `未找到 runId=${r.runId} 的运行记录`
        const v = toStatusView(snapshot)
        return JSON.stringify(v, null, 2)
      }
      case "cancel": {
        const r = await resolveRunIdArg(cmd.runId, "cancel")
        if ("message" in r) return r.message
        await deps.engine.cancel(r.runId)
        return `已取消 workflow，runId=${r.runId}`
      }
    }
  }

  return {
    handleCommand,
  }
}
