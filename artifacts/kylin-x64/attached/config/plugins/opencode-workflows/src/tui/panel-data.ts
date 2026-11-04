/**
 * OpenCode Workflows —— TUI 面板纯数据投影（无 JSX，可独立测试）。
 *
 * 把 WorkflowPanel 的纯计算辅助（分组、百分比、进度条、截断、状态归一）从 `.tsx`
 * 组件中拆出，置于本 `.ts` 模块。原因：`@opentui/solid` 仅随包提供 `jsx-runtime.d.ts`
 * （类型声明），无运行时 `jsx-runtime.js`；测试在 Bun 下 import 含 JSX 的 `.tsx` 会触发
 * JSX 运行时解析失败（`jsxDEV not found`）。将纯逻辑下沉到无 JSX 的模块后，
 * 单元/集成测试可直接 import 这些辅助而不加载 JSX 运行时（task 15.3）。
 *
 * `workflow-panel.tsx` 从本模块 re-export 这些函数，保持对外 API 不变。
 *
 * @see ./workflow-panel.tsx
 * Requirements: 10.2, 10.4, 10.5
 */

import type { AgentProgress, ProgressEntry, RunSnapshot, RunStatus } from "../types"

/** agent label 显示最大长度（R10.4）。 */
export const MAX_LABEL = 80

/** 面板同时显示的最大 run 数（避免侧栏过长）。 */
export const MAX_RUNS = 5

/**
 * 为面板显示排序 run 列表：running 优先，其余按 startTime 降序（最近启动在前），
 * 再截断到 `limit` 个。同一优先级内按 startTime 降序，保证活跃 run 始终可见。
 *
 * @param snapshots 全部 run 快照（顺序不限）。
 * @param limit 显示上限，默认 {@link MAX_RUNS}；`<= 0` 表示不截断。
 */
export function sortRunsForDisplay(snapshots: RunSnapshot[], limit = MAX_RUNS): RunSnapshot[] {
  const sorted = [...snapshots].sort((a, b) => {
    const aRunning = a.status === "running" ? 1 : 0
    const bRunning = b.status === "running" ? 1 : 0
    if (aRunning !== bRunning) return bRunning - aRunning
    return b.startTime - a.startTime
  })
  return limit > 0 ? sorted.slice(0, limit) : sorted
}

/** 状态显示文本（running/done/failed 归一）。 */
export function statusLabel(status: RunStatus): string {
  switch (status) {
    case "running":
      return "running"
    case "completed":
      return "done"
    case "failed":
      return "failed"
    case "cancelled":
      return "cancelled"
    case "paused":
      return "paused"
    case "pausing":
      return "pausing…"
  }
}

/** 仅取 agent 进度条目，按 index 去重（FIX-2 / BUG-008 兜底：旧快照可能含重复）。 */
export function agentEntries(progress: ProgressEntry[]): AgentProgress[] {
  const agents = progress.filter((e): e is AgentProgress => e.type === "workflow_agent")
  // 去重兜底（FIX-2）：旧快照可能含同 index 重复条目（resume 前未 upsert），以 last-wins 取值
  // （保留首次出现顺序、用末次出现的值），与 appendProgress upsert 语义、Journal last-wins 一致。
  const seen = new Map<number, AgentProgress>()
  const order: number[] = []
  for (const a of agents) {
    if (!seen.has(a.index)) order.push(a.index)
    seen.set(a.index, a)
  }
  return order.map((idx) => seen.get(idx)!)
}

/**
 * 完成百分比（已完成 agent / 已注册 agent 总数 ×100 向下取整，R10.5）。
 * 总数为 0 时返回 0，避免除零。
 */
export function completionPercent(progress: ProgressEntry[]): number {
  const agents = agentEntries(progress)
  if (agents.length === 0) return 0
  const done = agents.filter((a) => a.state === "done").length
  return Math.floor((done / agents.length) * 100)
}

/**
 * 是否可以展示百分比（FIX-3 / BUG-004）。
 *
 * running / pausing 状态下 agent 仍在动态注册，分母不稳定会导致百分比跳变——此时
 * 返回 false，调用方降级为「N/M 计数式」展示；终态或 paused 时分母已稳定，返回 true。
 */
export function shouldShowPercent(status: string): boolean {
  return status !== "running" && status !== "pausing"
}

/** 已完成数 / 总数。 */
export function completionCounts(progress: ProgressEntry[]): { done: number; total: number } {
  const agents = agentEntries(progress)
  return { done: agents.filter((a) => a.state === "done").length, total: agents.length }
}

/** label 截断到 ≤80 字符（R10.4）。 */
export function truncateLabel(label: string): string {
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label
}

/**
 * 按 phase 分组 agent 进度，保持 phase 首次出现顺序。
 * 无 phase（phaseTitle 为空）归入「(default)」组。
 */
export function groupByPhase(
  progress: ProgressEntry[],
): Array<{ phase: string; agents: AgentProgress[] }> {
  const agents = agentEntries(progress)
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
  return order.map((phase) => ({ phase, agents: map.get(phase)! }))
}

/** 文本进度条（done/total）。 */
export function progressBar(done: number, total: number, width = 20): string {
  if (total <= 0) return `[${" ".repeat(width)}]`
  const filled = Math.floor((done / total) * width)
  return `[${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}]`
}

/**
 * 切换某个 run 的折叠状态：返回**新的** Set（不修改入参，便于 Solid 信号变更检测与测试）。
 * runId 已在集合中 → 移除（展开）；否则加入（折叠）。
 *
 * @param collapsed 当前已折叠的 runId 集合。
 * @param runId 被点击切换的 run。
 */
export function toggleCollapsed(collapsed: ReadonlySet<string>, runId: string): Set<string> {
  const next = new Set(collapsed)
  if (next.has(runId)) next.delete(runId)
  else next.add(runId)
  return next
}

/** 折叠态箭头指示符：折叠 `▶`、展开 `▼`。 */
export function collapseArrow(collapsed: boolean): string {
  return collapsed ? "▶" : "▼"
}
