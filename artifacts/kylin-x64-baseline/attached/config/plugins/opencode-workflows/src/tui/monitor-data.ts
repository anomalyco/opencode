/**
 * OpenCode Workflows —— Workflow Monitor 全屏界面纯数据投影（无 JSX，可独立测试）。
 *
 * 与 panel-data.ts 同理：把 monitor 三层界面（列表 / phases / agent 详情）所需的**纯计算**
 * （journal 按 agentIndex 聚合、outcome 文本化、行分页/滚动窗口、选择索引夹取、
 * 时长/token 格式化、状态图标）下沉到无 JSX 的模块，便于单测绕过 JSX 运行时。
 *
 * monitor-screens.tsx（含 JSX）从本模块 import 这些函数。
 *
 * @see ./monitor-screens.tsx
 * @see ../../docs/workflow-monitor-第一期设计方案.md
 */

import type { AgentProgress, JournalEntry, RunSnapshot, RunStatus } from "../types"
import { agentEntries } from "./panel-data"

// ============================================================================
// 常量
// ============================================================================

/** 列表层最多显示的 run 数。 */
export const MAX_MONITOR_RUNS = 20

/** L2 详情 Prompt 折叠态显示的首行数。 */
export const PROMPT_COLLAPSED_LINES = 3

// ============================================================================
// 状态图标 / 格式化
// ============================================================================

/** run 状态图标。 */
export function statusIcon(status: RunStatus): string {
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

/** agent 状态图标。 */
export function agentStateIcon(state: AgentProgress["state"]): string {
  if (state === "done") return "✔"
  if (state === "running") return "▶"
  return "✗"
}

// ============================================================================
// 运行态控制守卫谓词（纯逻辑）
//
// monitor 全屏 `p`/`r`/`x`/`d` 按键分派的守卫判定（R7.1-R7.4）下沉为纯谓词，
// 与命令层 `filterRunsForCommand` 的过滤语义一致，便于单测覆盖各状态真值表。
// ============================================================================

/** 是否可暂停：仅 `running` 可暂停（R7.1）。`pausing` 已在暂停途中，不可重复暂停。 */
export function canPause(status: RunStatus): boolean {
  return status === "running"
}

/** 是否可恢复：非 `running`/`pausing` 的可恢复（paused/failed/cancelled/completed）。
 *  注：`pausing`（暂停途中）此刻仍持有活动执行体，应让其先落到 `paused` 再恢复，故不在此放行。 */
export function canResume(status: RunStatus): boolean {
  return status !== "running" && status !== "pausing"
}

/** 是否可终止：`running`/`pausing`/`paused` 可取消（R7.3）。 */
export function canCancel(status: RunStatus): boolean {
  return status === "running" || status === "pausing" || status === "paused"
}

/** 是否可删除：非 `running`/`pausing` 可删除（禁止删运行中/暂停中的活动 run，R7.4 / D3）。 */
export function canDelete(status: RunStatus): boolean {
  return status !== "running" && status !== "pausing"
}

/** 毫秒 → 紧凑时长（如 `1m23s` / `42.1s` / `—`）。 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—"
  if (ms < 1000) return `${ms}ms`
  const totalSec = ms / 1000
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`
  const min = Math.floor(totalSec / 60)
  const sec = Math.floor(totalSec % 60)
  return `${min}m${sec}s`
}

/** token 计数 → 紧凑显示（如 `18.2k` / `191`）。 */
export function formatTokens(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return "0"
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1)}k`
}

// ============================================================================
// Run 区分信息：runId 短前缀 / 启动时间 / 需求标签智能提取
// ============================================================================

/** runId 短前缀（默认 8 位，类 git/docker short SHA），用于在 UI 中绝对区分同名 run。 */
export function shortRunId(runId: string, len = 8): string {
  if (typeof runId !== "string") return ""
  return runId.length > len ? runId.slice(0, len) : runId
}

/**
 * 启动时间戳 → 本地 `HH:MM:SS`（24 小时制，零填充）。无效时间戳返回 `—`。
 * 用于在列表中按时序区分同名 run（哪个先跑、哪个后跑）。
 */
export function formatClockTime(ts: number | null | undefined): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts) || ts < 0) return "—"
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  const ss = String(d.getSeconds()).padStart(2, "0")
  return `${hh}:${mm}:${ss}`
}

/** deriveRunLabel 默认显示长度上限（字符）。 */
export const RUN_LABEL_MAX = 24

/** Windows/Unix 路径分隔符与盘符判定（用于从路径取文件名）。 */
const PATH_LIKE = /[\\/]/

/**
 * 从需求原文「智能提取」用于列表展示的简短标签（**纯函数**）。
 *
 * 提取策略（确定性、不调模型）：
 * 1. 折叠空白、取**首行**（`\n` 切分）；
 * 2. 在首行内取**首句**（遇句末标点 `。！？.!?;；` 截断），避免把整段塞进标签；
 * 3. 若结果**像文件路径**（含 `/` 或 `\`），提取**末段文件名**（区分度最高，避免显示一堆路径前缀）；
 * 4. 去除首尾标点/空白；
 * 5. 超过 `max` 再截断并加省略号 `…`。
 *
 * 空/全空白输入返回 undefined（调用方退化为仅显示 runId 短前缀 + 启动时间）。
 *
 * @param feature 需求原文（RunSnapshot.label）。
 * @param max 显示长度上限，默认 {@link RUN_LABEL_MAX}。
 */
export function deriveRunLabel(feature: string | null | undefined, max = RUN_LABEL_MAX): string | undefined {
  if (typeof feature !== "string") return undefined
  // 1. 首行
  const firstLine = feature.split(/\r?\n/)[0]?.replace(/\s+/g, " ").trim() ?? ""
  if (firstLine.length === 0) return undefined
  // 2. 首句：CJK 句末标点（。！？；）总是断句；ASCII .!?; 仅在其后为空白/行尾时才断句
  //    （避免把文件扩展名 `.md`、版本号 `v1.2` 等中间的 `.` 误当句末）。
  let core = firstLine
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i]
    if (ch === "。" || ch === "！" || ch === "？" || ch === "；") {
      core = firstLine.slice(0, i)
      break
    }
    if (ch === "." || ch === "!" || ch === "?" || ch === ";") {
      const next = firstLine[i + 1]
      if (next === undefined || /\s/.test(next)) {
        core = firstLine.slice(0, i)
        break
      }
    }
  }
  core = core.trim()
  // 3. 路径 → 取文件名末段
  if (PATH_LIKE.test(core)) {
    const segments = core.split(PATH_LIKE).filter((s) => s.length > 0)
    const last = segments[segments.length - 1]
    if (last && last.length > 0) core = last
  }
  // 4. 去首尾标点/空白
  core = core.replace(/^[\s"'「『（(【\-—·]+/, "").replace(/[\s"'」』）)】\-—·]+$/, "").trim()
  if (core.length === 0) return undefined
  // 5. 限长
  return core.length > max ? `${core.slice(0, max)}…` : core
}

// ============================================================================
// 选择索引 / 滚动窗口
// ============================================================================

/**
 * 将选择索引夹取到 `[0, length-1]`；空集合返回 0。
 * 用于上/下移动后保证索引合法（不环绕）。
 */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  if (index < 0) return 0
  if (index >= length) return length - 1
  return index
}

/**
 * 计算滚动窗口：在 `total` 行中，从 `offset` 起取 `height` 行。
 * 返回规整后的 `offset`（保证窗口不越界）与可见区间 `[from, to)`（半开）。
 *
 * @param total 总行数。
 * @param offset 期望起始行（可能越界，将被夹取）。
 * @param height 视口高度（行数），`<=0` 视为 1。
 */
export function scrollWindow(
  total: number,
  offset: number,
  height: number,
): { offset: number; from: number; to: number } {
  const h = height > 0 ? Math.floor(height) : 1
  if (total <= 0) return { offset: 0, from: 0, to: 0 }
  const maxOffset = Math.max(0, total - h)
  const clamped = Math.max(0, Math.min(Math.floor(offset), maxOffset))
  return { offset: clamped, from: clamped, to: Math.min(total, clamped + h) }
}

/** 把文本按换行拆为行数组（空文本返回空数组）。 */
export function splitLines(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return []
  return text.split("\n")
}

// ============================================================================
// Journal 聚合
// ============================================================================

/** 单个 agent 从 journal 聚合出的输入/输出。 */
export interface AgentJournal {
  /** agent_started 记录的 prompt（末次出现优先）。 */
  prompt?: string
  /** agent_result 记录的 result（末次出现优先）。 */
  result?: unknown
  /** agent_result 记录的 error（末次出现优先）。 */
  error?: string
}

/**
 * 按 agentIndex 聚合 journal 事件：同一 index 的 started/result 取**末次出现**
 * （与 resume-engine 的「末次出现优先」语义一致，避免被覆盖的旧记录干扰）。
 *
 * @param entries Journal 全部事件（顺序即文件顺序）。
 */
export function journalByAgent(entries: JournalEntry[]): Map<number, AgentJournal> {
  const map = new Map<number, AgentJournal>()
  for (const e of entries) {
    if (typeof e.agentIndex !== "number") continue
    const cur = map.get(e.agentIndex) ?? {}
    if (e.eventType === "agent_started") {
      if (typeof e.prompt === "string") cur.prompt = e.prompt
      // 末次事件是 started = 该 agentIndex 处于新一轮运行中（pause→resume 重跑、gate 修正
      // 重试的运行窗口）：上一轮终态（无论成败）已被本轮覆盖，必须清除——保留旧错误会与
      // 元信息的 running 状态矛盾（用户会误以为本次运行也是失败的）。完整历史仍在
      // journal.jsonl 可审计；与 resume-engine「started 即新一轮」的语义一致。
      delete cur.result
      delete cur.error
    } else if (e.eventType === "agent_result") {
      // 末次 result 事件代表该 agentIndex 的**整体终态**（对齐 resume-engine「末次 result
      // 不含 error 即 completed」的判定，resume-engine.ts 同名语义）：成功 → 覆盖 result 并
      // 清除历史 error；失败 → 覆盖 error 并清除历史 result。gate 重试的典型时序是同一
      // agentIndex 先败后成（如网络抖动后恢复），若只写不清会残留首次失败文案，使 L3 把
      // 最终成功的 agent 显示为「错误：…」。
      if ("result" in e) {
        cur.result = e.result
        delete cur.error
      } else if (typeof e.error === "string") {
        cur.error = e.error
        delete cur.result
      }
    }
    map.set(e.agentIndex, cur)
  }
  return map
}

/**
 * 把 agent 的 result/error 转为可显示文本：
 * - error 优先，前缀「错误：」；
 * - result 为 string 直接用；为对象则 JSON 美化序列化；
 * - 皆无返回占位。
 */
export function toOutcomeText(result: unknown, error?: string): string {
  if (typeof error === "string" && error.length > 0) return `错误：${error}`
  if (result === undefined || result === null) return "（暂无输出）"
  if (typeof result === "string") return result
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

// ============================================================================
// 第二期：OpenCode session 日志拍平（消费 SDK session.messages 结果）
// ============================================================================

/**
 * SDK 消息 part 的**最小结构**（仅声明本模块消费的字段）。
 *
 * 真实来源：`client.session.messages({ sessionID })` 返回的
 * `Array<{ info: Message, parts: Part[] }>`（SDK v2）。这里用宽松可选字段定义，
 * 解耦 SDK 版本差异，并便于测试用纯对象夹具构造。
 */
export interface SdkMessagePart {
  type: string
  text?: string
  tool?: string
  callID?: string
  state?: {
    status?: string
    input?: Record<string, unknown>
    output?: string
    error?: string
    title?: string
  }
  synthetic?: boolean
}

/** SDK 消息 info 的最小结构。 */
export interface SdkMessageInfo {
  role?: string
  modelID?: string
  providerID?: string
}

/** SDK session.messages 的单条（info + parts）。 */
export interface SdkMessageWithParts {
  info: SdkMessageInfo
  parts: SdkMessagePart[]
}

/** 工具调用状态图标。 */
export function toolStatusIcon(status: string | undefined): string {
  switch (status) {
    case "completed":
      return "✔"
    case "running":
      return "▶"
    case "pending":
      return "…"
    case "error":
      return "✗"
    default:
      return "·"
  }
}

/** 单行字符上限（超出截断加省略号），避免单行过长撑乱布局。 */
const MAX_LINE = 200

function clip(text: string, max = MAX_LINE): string {
  const s = text.replace(/\r/g, "")
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/**
 * 从工具入参提取一行「目标摘要」：write/edit/read→路径，bash→命令，grep/glob→模式，
 * 其它取首个字符串字段；无可显示则返回空串。
 */
export function summarizeToolInput(_tool: string, input: Record<string, unknown> | undefined): string {
  if (!input || typeof input !== "object") return ""
  const pick = (k: string): string | undefined =>
    typeof input[k] === "string" ? (input[k] as string) : undefined
  const path = pick("filePath") ?? pick("path")
  if (path) return path
  const cmd = pick("command")
  if (cmd) return clip(cmd, 120)
  const pattern = pick("pattern") ?? pick("query")
  if (pattern) return clip(pattern, 120)
  for (const v of Object.values(input)) {
    if (typeof v === "string" && v.length > 0) return clip(v, 120)
  }
  return ""
}

/**
 * 把单个 agent 的 OpenCode 会话消息**按时间顺序拍平**为行缓冲区（与 {@link composeAgentLines}
 * 同构，供 AgentView 套**单一滚动窗口**渲染，杜绝溢出叠绘）。
 *
 * 渲染规则（R 第二期）：
 * - user 消息 → `▌user` 标题；assistant → `▌assistant · <model>`；
 * - text part → 文本行（跳过 synthetic）；reasoning → muted 文本（推理过程）；
 * - tool part → `⚙ <tool> <状态图标>` + `→ <input 摘要>` +（completed/error）输出/错误摘要。
 *
 * @param messages SDK `session.messages` 返回的 `{ info, parts }[]`（已按时间序）。
 */
export function flattenSessionLog(messages: SdkMessageWithParts[]): MonitorLine[] {
  const lines: MonitorLine[] = []
  for (const msg of messages) {
    const role = msg.info?.role ?? "?"
    if (role === "assistant") {
      const model = msg.info?.modelID ? ` · ${msg.info.modelID}` : ""
      lines.push({ text: `▌assistant${model}`, tone: "section" })
    } else {
      lines.push({ text: `▌${role}`, tone: "section" })
    }

    for (const part of msg.parts ?? []) {
      if (part.type === "text") {
        if (part.synthetic) continue
        const text = (part.text ?? "").trim()
        if (text.length === 0) continue
        for (const ln of text.split("\n")) lines.push({ text: `  ${clip(ln)}`, tone: "body" })
      } else if (part.type === "reasoning") {
        const text = (part.text ?? "").trim()
        if (text.length === 0) continue
        for (const ln of text.split("\n")) lines.push({ text: `  ${clip(ln)}`, tone: "muted" })
      } else if (part.type === "tool") {
        const st = part.state ?? {}
        const running = st.status === "running" ? " running" : ""
        lines.push({ text: `  ⚙ ${part.tool ?? "tool"} ${toolStatusIcon(st.status)}${running}`, tone: "meta" })
        const inSummary = summarizeToolInput(part.tool ?? "", st.input)
        if (inSummary) lines.push({ text: `    → ${inSummary}`, tone: "muted" })
        if (st.status === "error" && st.error) {
          lines.push({ text: `    ✗ ${clip(st.error, 160)}`, tone: "body" })
        } else if (st.status === "completed" && typeof st.output === "string" && st.output.length > 0) {
          const outLines = st.output.split("\n")
          for (const ln of outLines.slice(0, 3)) lines.push({ text: `    ${clip(ln)}`, tone: "body" })
          if (outLines.length > 3) lines.push({ text: `    … 输出共 ${outLines.length} 行`, tone: "muted" })
        }
      }
      // step-start / step-finish / file 等第二期从略，避免噪声。
    }
  }
  return lines
}

/** 统计某 agent 会话消息里的工具调用数（ToolPart 计数），用于 L1「N tools」。 */
export function countToolParts(messages: SdkMessageWithParts[]): number {
  let n = 0
  for (const msg of messages) {
    for (const part of msg.parts ?? []) {
      if (part.type === "tool") n++
    }
  }
  return n
}

// ============================================================================
// Run / Phase / Agent 投影
// ============================================================================

/** 列表行投影（L0）。 */
export interface MonitorListRow {
  runId: string
  workflowName: string
  status: RunStatus
  agentCount: number
  totalTokens: number
  durationMs: number | null
  /** 启动时间戳（区分同名 run 的时序）。 */
  startTime: number
  /** 需求原文（区分同名 run 的语义）；可缺省。 */
  label?: string
}

/** 从 snapshot 投影列表行。 */
export function toListRow(s: RunSnapshot): MonitorListRow {
  return {
    runId: s.runId,
    workflowName: s.workflowName,
    status: s.status,
    agentCount: s.agentCount,
    totalTokens: s.totalTokens,
    durationMs: s.durationMs,
    startTime: s.startTime,
    ...(typeof s.label === "string" && s.label.length > 0 ? { label: s.label } : {}),
  }
}

/** 某阶段的分组（L1 左栏）。 */
export interface MonitorPhaseGroup {
  phase: string
  agents: AgentProgress[]
  done: number
  total: number
}

/**
 * 按 phaseTitle 分组某 run 的 agent（保持首次出现顺序），并附带每阶段完成计数。
 * 无 phaseTitle 的 agent 归入「(default)」。
 */
export function phaseGroups(snapshot: RunSnapshot): MonitorPhaseGroup[] {
  const agents = agentEntries(snapshot.workflowProgress)
  const order: string[] = []
  const map = new Map<string, AgentProgress[]>()
  for (const a of agents) {
    const key = a.phaseTitle && a.phaseTitle.length > 0 ? a.phaseTitle : "(default)"
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(a)
  }
  return order.map((phase) => {
    const list = map.get(phase)!
    return {
      phase,
      agents: list,
      done: list.filter((a) => a.state === "done").length,
      total: list.length,
    }
  })
}

/** 某 run 全部 agent，按 index 升序（L2 上/下切换用的扁平序列）。 */
export function agentsSorted(snapshot: RunSnapshot): AgentProgress[] {
  return [...agentEntries(snapshot.workflowProgress)].sort((a, b) => a.index - b.index)
}

/** L2 详情视图模型。 */
export interface MonitorAgentDetail {
  label: string
  phaseTitle: string
  model: string
  state: AgentProgress["state"]
  tokens: number
  durationMs: number
  promptLines: string[]
  outcomeLines: string[]
}

/** 详情缓冲区单行的样式类别（由 AgentView 映射为主题色）。 */
export type LineTone = "title" | "meta" | "section" | "divider" | "body" | "muted"

/** 详情缓冲区单行。 */
export interface MonitorLine {
  text: string
  tone: LineTone
}

/** 分隔线宽度。 */
const DIVIDER_WIDTH = 60

/**
 * Activity 段（agent 会话日志）的渲染输入（由 monitor-screens.tsx 从 OpenCode
 * `session.messages` 拉取并经 {@link flattenSessionLog} 拍平后注入）。
 *
 * 设计为「数据缺失也能渲染」：`lines` 为空数组时 {@link composeAgentLines} 渲染
 * `placeholder` 占位说明（muted），保证三段式结构（Prompt → Activity → Outcome）
 * **恒定同框**，不再因有无会话日志而整页切换形态。
 */
export interface AgentActivity {
  /** {@link flattenSessionLog} 拍平后的会话日志行；空数组表示暂无可显示内容（走占位）。 */
  lines: MonitorLine[]
  /** 工具调用计数（段标题 `Activity · N tools` 用）。 */
  toolCount: number
  /** `lines` 为空时显示的占位说明（muted）；区分「无 session」「加载中/无工具调用」等情形。 */
  placeholder: string
}

/**
 * 把单个 agent 的全部内容（头部 + Prompt + Activity + Outcome）拼成**一个连续行缓冲区**。
 *
 * 关键：所有段落同处一个缓冲区，由 AgentView 套**单一滚动窗口**渲染——任何时刻只渲染
 * 一屏的行，彻底避免「展开后内容溢出固定高度容器导致叠绘」（与 Claude Code 一致）。
 *
 * **统一结构（恒定三段同框）**：无论该 agent 是否已采集到 OpenCode 会话日志，输出都固定为
 * `头部 → Prompt → Activity → Outcome` 四块。Activity 块的内容来自 `activity.lines`
 * （会话日志拍平行）；缺失（`activity` 未传或 `lines` 为空）时渲染 `placeholder` 占位，
 * 不再像旧实现那样「有日志就整页替换、无日志才显示三段」造成形态不一致。
 *
 * @param detail agent 详情视图模型（Prompt/Outcome 源自 journal）。
 * @param promptExpanded Prompt 是否展开（false 时只放首 {@link PROMPT_COLLAPSED_LINES} 行 + 省略提示）。
 * @param activity Activity 段输入（会话日志拍平行 + 工具数 + 占位文案）；缺省按「无会话日志」占位。
 */
export function composeAgentLines(
  detail: MonitorAgentDetail,
  promptExpanded: boolean,
  activity?: AgentActivity,
): MonitorLine[] {
  const lines: MonitorLine[] = []
  const divider = (): void => {
    lines.push({ text: "─".repeat(DIVIDER_WIDTH), tone: "divider" })
  }

  // 头部
  lines.push({
    text: `${agentStateIcon(detail.state)} ${detail.state} · ${detail.model} · ${formatTokens(detail.tokens)} tok · ${formatDuration(detail.durationMs)}`,
    tone: "meta",
  })
  divider()

  // Prompt
  const promptMore = Math.max(0, detail.promptLines.length - PROMPT_COLLAPSED_LINES)
  const promptHint =
    !promptExpanded && promptMore > 0
      ? ` · e 展开（+${promptMore}）`
      : promptExpanded && promptMore > 0
        ? " · e 折叠"
        : ""
  lines.push({ text: `Prompt · ${detail.promptLines.length} lines${promptHint}`, tone: "section" })
  const promptShown = promptExpanded
    ? detail.promptLines
    : detail.promptLines.slice(0, PROMPT_COLLAPSED_LINES)
  for (const line of promptShown) lines.push({ text: `  ${line}`, tone: "body" })
  if (!promptExpanded && promptMore > 0) {
    lines.push({ text: `  … ${promptMore} more lines`, tone: "muted" })
  }

  // Activity（会话日志；缺失时占位——三段式恒定同框）
  divider()
  const hasActivity = activity !== undefined && activity.lines.length > 0
  lines.push({
    text: hasActivity ? `Activity · ${activity!.toolCount} tools` : "Activity",
    tone: "section",
  })
  if (hasActivity) {
    for (const l of activity!.lines) lines.push(l)
  } else {
    const placeholder = activity?.placeholder ?? "—（暂无会话日志）—"
    lines.push({ text: `  ${placeholder}`, tone: "muted" })
  }

  // Outcome（全部行纳入同一缓冲区）
  divider()
  lines.push({ text: "Outcome", tone: "section" })
  for (const line of detail.outcomeLines) lines.push({ text: `  ${line}`, tone: "body" })

  return lines
}

/**
 * 组装某 agent 的详情视图：合并 snapshot 的 AgentProgress（元信息）与 journal 聚合
 * （prompt/outcome）。journal 缺该 index 时 prompt/outcome 为占位。
 *
 * @param agent 该 agent 的进度条目。
 * @param journal 该 agent 的 journal 聚合（journalByAgent 的某项），可空。
 */
export function buildAgentDetail(
  agent: AgentProgress,
  journal: AgentJournal | undefined,
): MonitorAgentDetail {
  const prompt = journal?.prompt ?? ""
  const outcome = toOutcomeText(journal?.result, journal?.error)
  return {
    label: agent.label,
    phaseTitle: agent.phaseTitle && agent.phaseTitle.length > 0 ? agent.phaseTitle : "(default)",
    model: agent.model || "—",
    state: agent.state,
    tokens: agent.tokens,
    durationMs: agent.durationMs,
    promptLines: splitLines(prompt),
    outcomeLines: splitLines(outcome),
  }
}
