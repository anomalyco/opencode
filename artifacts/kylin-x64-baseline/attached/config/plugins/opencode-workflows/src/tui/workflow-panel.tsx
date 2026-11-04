/** @jsxImportSource @opentui/solid */
/**
 * OpenCode Workflows —— TUI 进度面板（WorkflowPanel / WorkflowPanelList）。
 *
 * 以 @opentui/solid + solid-js 渲染 Run 进度，数据来源为 Run Snapshot
 * （由 tui.tsx 经**文件监听 + 定时轮询兜底** `workflowProgress` 变化驱动；R10.3/R3.3）。
 *
 * - {@link WorkflowPanel}：渲染**单个** Run 的进度（保留以兼容直接调用方与测试）。
 * - {@link WorkflowPanelList}：渲染**多个** Run（running 优先、最近启动在前，至多 MAX_RUNS 个），
 *   各 Run 之间以分隔线区隔。这样并发/连续启动的多个 workflow 都能同时可见，
 *   而非只显示最近一个。
 *
 * **折叠交互（鼠标）**：每个 Run 的标题行可点击（`onMouseDown` 左键），点击在「展开/折叠」
 * 间切换该 Run（粒度：单个 Run 独立）。折叠态仅保留标题 + 状态 + 进度条，隐藏 agent 明细；
 * 箭头 `▼`=展开、`▶`=折叠。折叠状态由上层（tui.tsx）以 `Set<runId>` 维护，轮询刷新数据
 * 不会重置用户的折叠选择。新 Run 默认展开。
 *
 * 显示要素（R10.1-R10.6）：
 * - Workflow 名称与状态（running/done/failed → completed/cancelled 归一显示）；
 * - 按 phase 分组的 agent 进度：label（≤80 截断）、model、tokens、duration、status；
 * - 完成百分比（已完成 agent / 已注册 agent 总数 ×100 向下取整）与「已完成/总数」进度条；
 * - 空状态（无 run/无历史）显示占位；Snapshot 不可读由上层保留上次内容（本组件仅渲染传入快照）。
 *
 * 本组件为**纯展示**：不读文件、不监听事件——数据由 props 注入，
 * 文件监听/轮询与信号驱动在 tui.tsx 完成，便于组件测试。
 *
 * @see .kiro/specs/opencode-workflows/design.md — 10. TUI_Panel
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 13.3
 */

import { For, Show, type JSX } from "solid-js"
import type { TuiSlotContext } from "@opencode-ai/plugin/tui"
import type { MouseEvent as TuiMouseEvent } from "@opentui/core"
import type { AgentProgress, RunSnapshot, RunStatus } from "../types"
import { deriveRunLabel } from "./monitor-data"
import {
  agentEntries,
  collapseArrow,
  completionCounts,
  completionPercent,
  groupByPhase,
  progressBar,
  shouldShowPercent,
  sortRunsForDisplay,
  statusLabel,
  toggleCollapsed,
  truncateLabel,
} from "./panel-data"

// 纯计算辅助从无 JSX 的 panel-data 模块 re-export，保持对外 API 不变，
// 同时让测试可绕过 JSX 运行时直接 import（见 panel-data.ts 头注释）。
export {
  agentEntries,
  collapseArrow,
  completionCounts,
  completionPercent,
  groupByPhase,
  progressBar,
  shouldShowPercent,
  sortRunsForDisplay,
  statusLabel,
  toggleCollapsed,
  truncateLabel,
} from "./panel-data"

type Theme = TuiSlotContext["theme"]

/** WorkflowPanel props。 */
export interface WorkflowPanelProps {
  /** Run 快照；为 null 时渲染空状态（R10.6）。 */
  snapshot: RunSnapshot | null
  theme: Theme
}

// ============================================================================
// 颜色映射
// ============================================================================

function statusColor(status: RunStatus, theme: Theme) {
  const t = theme.current
  switch (status) {
    case "completed":
      return t.success
    case "running":
      return t.info
    case "failed":
      return t.error
    case "cancelled":
      return t.warning
    case "paused":
      return t.warning
  }
}

function agentStateColor(state: AgentProgress["state"], theme: Theme) {
  const t = theme.current
  if (state === "done") return t.success
  if (state === "running") return t.info
  return t.error
}

// ============================================================================
// 组件
// ============================================================================

/** 单个 agent 行。 */
function AgentRow(props: { agent: AgentProgress; theme: Theme }): JSX.Element {
  const a = props.agent
  const meta = `${a.model || "-"} · ${a.tokens}tok · ${a.durationMs}ms`
  return (
    <box flexDirection="column" paddingLeft={2}>
      <text fg={agentStateColor(a.state, props.theme)}>
        {`• ${truncateLabel(a.label)} [${a.state}]`}
      </text>
      <text fg={props.theme.current.textMuted}>{`  ${meta}`}</text>
    </box>
  )
}

/** 单个非空 Run 的内容块（标题 + 进度条 + 分组 agent + 错误）。供单/多面板复用。 */
function RunBody(props: {
  snapshot: RunSnapshot
  theme: Theme
  /** 该 Run 是否折叠（折叠时隐藏 agent 明细，仅保留标题 + 进度条）。 */
  collapsed?: boolean
  /** 点击标题行时回调（左键），由上层切换折叠状态。 */
  onToggle?: (runId: string) => void
}): JSX.Element {
  const snap = () => props.snapshot
  const groups = () => groupByPhase(snap().workflowProgress)
  const counts = () => completionCounts(snap().workflowProgress)
  const percent = () => completionPercent(snap().workflowProgress)
  const collapsed = () => props.collapsed === true

  // 标题行鼠标点击：仅响应左键（button 0）的按下，切换折叠。
  const handleTitleMouse = (event: TuiMouseEvent): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    props.onToggle?.(snap().runId)
  }

  return (
    <box flexDirection="column">
      {/* 标题行（可点击切换折叠）：箭头 + 名称 + 需求标签 + 状态 */}
      <box onMouseDown={handleTitleMouse}>
        <text fg={statusColor(snap().status, props.theme)}>
          {`${collapseArrow(collapsed())} ⚙ ${snap().workflowName}${
            deriveRunLabel(snap().label) ? `「${deriveRunLabel(snap().label)}」` : ""
          }  [${statusLabel(snap().status)}]`}
        </text>
      </box>

      {/* 完成百分比 + 进度条（折叠态也保留，便于一眼看进度）。FIX-3：running/pausing 时不显示会跳变的百分比 */}
      <text fg={props.theme.current.text}>
        {`${progressBar(counts().done, counts().total)} ${
          shouldShowPercent(snap().status)
            ? `${percent()}%  (${counts().done}/${counts().total})`
            : `${counts().done}/${counts().total} agents`
        }`}
      </text>

      {/* agent 明细 + 错误详情：仅展开态显示（折叠态由标题行 [failed] 标识失败，错误详情收起） */}
      <Show when={!collapsed()}>
        <For each={groups()}>
          {(group) => (
            <box flexDirection="column">
              <text fg={props.theme.current.accent}>{`▸ ${group.phase}`}</text>
              <For each={group.agents}>
                {(agent) => <AgentRow agent={agent} theme={props.theme} />}
              </For>
            </box>
          )}
        </For>

        {/* 错误指示（仅展开态显示，避免折叠态占多行） */}
        <Show when={snap().error}>
          <text fg={props.theme.current.error}>{`错误：${snap().error}`}</text>
        </Show>
      </Show>
    </box>
  )
}

/** Workflow 进度面板主组件（单 run）。null 快照时渲染空状态（R10.6）。 */
export function WorkflowPanel(props: WorkflowPanelProps): JSX.Element {
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {/* 空状态占位（无 run / 无历史，R10.6） */}
      <Show when={!props.snapshot}>
        <text fg={props.theme.current.textMuted}>（暂无 workflow 运行记录）</text>
      </Show>

      <Show when={props.snapshot}>
        <RunBody snapshot={props.snapshot as RunSnapshot} theme={props.theme} />
      </Show>
    </box>
  )
}

/** WorkflowPanelList props。 */
export interface WorkflowPanelListProps {
  /** 已排序的 Run 快照数组（顺序即显示顺序）；空数组时渲染空状态（R10.6）。 */
  snapshots: RunSnapshot[]
  theme: Theme
  /** 已折叠的 runId 集合（不在集合中即展开）。缺省视为全部展开。 */
  collapsed?: ReadonlySet<string>
  /** 点击某 Run 标题行的回调，由上层切换该 runId 的折叠状态。 */
  onToggle?: (runId: string) => void
}

/**
 * 多 Run 进度面板：依次渲染传入的每个 Run（顺序由上层 {@link sortRunsForDisplay} 决定），
 * 各 Run 之间以分隔线区隔。每个 Run 标题行可点击折叠/展开（粒度独立）。
 * 空数组时渲染空状态占位。
 */
export function WorkflowPanelList(props: WorkflowPanelListProps): JSX.Element {
  const isCollapsed = (runId: string): boolean => props.collapsed?.has(runId) === true

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {/* 空状态占位（无 run / 无历史，R10.6） */}
      <Show when={props.snapshots.length === 0}>
        <text fg={props.theme.current.textMuted}>（暂无 workflow 运行记录）</text>
      </Show>

      <For each={props.snapshots}>
        {(snap, i) => (
          <box flexDirection="column">
            {/* run 之间的分隔线（首个 run 前不加） */}
            <Show when={i() > 0}>
              <text fg={props.theme.current.textMuted}>{"─".repeat(28)}</text>
            </Show>
            <RunBody
              snapshot={snap}
              theme={props.theme}
              collapsed={isCollapsed(snap.runId)}
              onToggle={props.onToggle}
            />
          </box>
        )}
      </For>
    </box>
  )
}

/** 空状态占位（无 run / 无历史，R10.6）。保留以兼容直接调用方。 */
export function WorkflowPanelEmpty(props: { theme: Theme }): JSX.Element {
  return (
    <box paddingLeft={1}>
      <text fg={props.theme.current.textMuted}>（暂无 workflow 运行记录）</text>
    </box>
  )
}
