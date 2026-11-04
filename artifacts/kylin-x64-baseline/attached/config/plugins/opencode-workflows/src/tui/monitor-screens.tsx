/** @jsxImportSource @opentui/solid */
/**
 * OpenCode Workflows —— Workflow Monitor 全屏界面（三层下钻）。
 *
 * 单一全屏路由 `workflow-monitor`，内部用 `view` 信号在三层间切换（避免 3 条 route 间
 * 传 params 的复杂度）：
 *   - L0 list：所有 run 列表（↑↓ 选择、Enter 进入、Esc 关闭）
 *   - L1 run ：选中 run 的 phases 双栏（↑↓ 选阶段/agent、Tab 切栏、Enter 看 agent、Esc 回 L0）
 *   - L2 agent：单 agent 的 Prompt + Outcome + 元信息（↑↓ 切 agent、j/k 滚动、e 展开 prompt、Esc 回 L1）
 *
 * 数据：由上层 tui.tsx 提供「快照数组」「journal 读取」accessor，本组件纯展示 + 交互，
 * 不直接读文件。键盘经 useKeyboard（仅当本路由激活时响应），鼠标经 onMouseDown。
 *
 * 实时刷新：tui.tsx 的轮询更新 snapshots 信号 → 本组件随之重渲染（running run 实时跳动）。
 *
 * @see ./monitor-data.ts — 纯数据投影
 * @see ../../docs/workflow-monitor-第一期设计方案.md
 */

import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import type { TuiPluginApi, TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { KeyEvent } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"

import type { AgentProgress, JournalEntry, RunSnapshot } from "../types"
import { sortRunsForDisplay } from "./panel-data"
import {
  agentStateIcon,
  agentsSorted,
  buildAgentDetail,
  canCancel,
  canDelete,
  canPause,
  canResume,
  clampIndex,
  composeAgentLines,
  countToolParts,
  deriveRunLabel,
  flattenSessionLog,
  formatClockTime,
  formatDuration,
  formatTokens,
  journalByAgent,
  type LineTone,
  type MonitorAgentDetail,
  type MonitorLine,
  MAX_MONITOR_RUNS,
  phaseGroups,
  scrollWindow,
  type SdkMessageWithParts,
  shortRunId,
  statusIcon,
  toListRow,
} from "./monitor-data"

/** 路由名（唯一全屏路由）。 */
export const MONITOR_ROUTE = "workflow-monitor"

/** MonitorScreen 的渲染入口（供 tui.tsx 注册 route 时调用，保持 tui.tsx JSX-free）。 */
export function renderMonitorRoute(props: MonitorScreenProps): JSX.Element {
  return <MonitorScreen {...props} />
}

type Theme = TuiThemeCurrent

/** 当前下钻层级。 */
type View = "list" | "run" | "agent"

/** L1 焦点栏。 */
type RunFocus = "phase" | "agent"

/**
 * Monitor 运行态控制句柄（WorkflowEngine 的方法子集）。
 *
 * 由调用方（tui.tsx 的 renderMonitorRoute，任务 8.1 注入）传入；monitor 全屏的
 * `p`/`r`/`x`/`d` 按键经此调用引擎的 pause/resume/cancel/delete。仅声明本组件
 * 消费的四个方法，避免与完整 `WorkflowEngine` 接口强耦合（pause/cancel/delete 返回
 * void，resume 返回 runId）。
 */
export interface MonitorEngine {
  pause(runId: string): Promise<void>
  resume(runId: string): Promise<string>
  cancel(runId: string): Promise<void>
  delete(runId: string): Promise<void>
}

/**
 * monitor 按键运行态控制的反馈描述：按键操作成功后经 {@link MonitorScreenProps.notifyControl}
 * 交给 tui.tsx 注入来源 session 的对话流（与命令路径同款 noReply 回执，使 Esc 返回后
 * 用户能看到操作痕迹与 sidebar 任务面板）。
 */
export interface MonitorControlFeedback {
  /** 控制动作类型（与 p/r/x/d 四键一一对应）。 */
  kind: "pause" | "resume" | "cancel" | "delete"
  /** 目标 runId。 */
  runId: string
  /** 目标 workflow 名（回执文案展示用）。 */
  workflowName?: string
}

export interface MonitorScreenProps {
  api: TuiPluginApi
  /** 已排序的 run 快照 accessor（响应式，由 tui.tsx 轮询更新）。 */
  snapshots: () => RunSnapshot[]
  /** 同步读取某 run 的 journal 缓存（由 tui.tsx 维护；未就绪返回空数组）。 */
  journalOf: (runId: string) => JournalEntry[]
  /** 请求 tui.tsx 拉取某 run 的 journal（进入 L1/L2 时调用，异步填充缓存）。 */
  requestJournal: (runId: string) => void
  /** 同步读取某 OpenCode 子 session 的会话日志（消息+parts）缓存；未就绪返回空数组（R 第二期）。 */
  sessionLogOf: (sessionID: string) => SdkMessageWithParts[]
  /** 请求 tui.tsx 拉取并订阅某子 session 的会话日志（进入 L2 时调用，异步填充缓存）。 */
  requestSessionLog: (sessionID: string) => void
  /**
   * 运行态控制引擎句柄（pause/resume/cancel/delete）。由 tui.tsx 注入（任务 8.1）。
   *
   * 缺省（未注入）时按键控制为 no-op——仅在装配尚未接通时的保底，不致崩溃。
   */
  engine?: MonitorEngine
  /**
   * 手动刷新回调（旧 `r` 键）。**已不再绑定 `r`**（`r` 改为 resume，R7.5）：自动轮询
   * 由 tui.tsx 的「文件监听 + 2s 轮询 + 事件监听」承担，无需手动刷新键。保留此 prop
   * 仅为兼容调用方装配（tui.tsx）不破坏；组件内部不再绑定任何按键到它。
   */
  onRefresh?: () => void
  /**
   * 关闭 Monitor（L0 列表层 Esc）的回调。
   *
   * 由 tui.tsx 注入：导航回**打开 Monitor 之前的来源路由**（通常是用户当时所在的
   * 工作 session），而非一律跳到 home 主界面。缺省（未注入）时组件回退到 home 以保底。
   */
  onClose?: () => void
  /**
   * 按键控制成功后的反馈注入回调（由 tui.tsx 注入）。`p/r/x/d` 操作成功后经
   * {@link runControl} fire-and-forget 调用，向来源 session 注入 noReply 回执
   * （与命令路径反馈一致）。缺省（未注入）时静默跳过——兼容只读装配与既有测试。
   */
  notifyControl?: (fb: MonitorControlFeedback) => void
}

function statusColor(status: RunSnapshot["status"], t: Theme) {
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

/**
 * 为 Activity 段（会话日志缺失时）生成占位说明，区分不同缺失情形便于排查：
 * - 无 `sessionID`：子 session 尚未创建（agent 仍排队/创建失败），或为旧运行记录（第二期前无此字段）；
 * - 有 `sessionID` 但暂未拉到日志：正在加载，或该 agent 确实未触发任何工具调用。
 *
 * @param sid 该 agent 的子 session id（缺省表示未回填）。
 * @param state 该 agent 进度状态（用于措辞：running 时倾向「加载中」）。
 */
function activityPlaceholder(sid: string | undefined, state: AgentProgress["state"] | undefined): string {
  if (!sid) return "—（子 session 未创建，或为旧运行记录，无会话日志）—"
  if (state === "running") return "—（会话日志加载中…）—"
  return "—（暂无会话日志：该 agent 未触发工具调用，或日志尚未采集）—"
}

/**
 * Workflow Monitor 全屏组件。
 */
export function MonitorScreen(props: MonitorScreenProps): JSX.Element {
  const dim = useTerminalDimensions()
  const theme = (): Theme => props.api.theme.current

  // ── 导航状态 ──
  const [view, setView] = createSignal<View>("list")
  const [runIndex, setRunIndex] = createSignal(0) // L0 选中行
  const [activeRunId, setActiveRunId] = createSignal<string | null>(null)
  const [phaseIndex, setPhaseIndex] = createSignal(0) // L1 左栏
  const [agentIndex, setAgentIndex] = createSignal(0) // L1 右栏 / L2 当前
  const [focus, setFocus] = createSignal<RunFocus>("phase")
  const [promptExpanded, setPromptExpanded] = createSignal(false)
  const [scrollOffset, setScrollOffset] = createSignal(0)

  // ── 派生数据 ──
  const runs = createMemo(() => sortRunsForDisplay(props.snapshots(), MAX_MONITOR_RUNS))

  /** 当前激活的 run 快照（L1/L2）。 */
  const activeRun = createMemo<RunSnapshot | null>(() => {
    const id = activeRunId()
    if (!id) return null
    return props.snapshots().find((s) => s.runId === id) ?? null
  })

  const groups = createMemo(() => {
    const run = activeRun()
    return run ? phaseGroups(run) : []
  })

  /** 当前选中阶段的 agent 列表。 */
  const phaseAgents = createMemo(() => {
    const g = groups()
    const pi = clampIndex(phaseIndex(), g.length)
    return g[pi]?.agents ?? []
  })

  /** L2：当前 run 全部 agent（按 index 升序）。 */
  const flatAgents = createMemo(() => {
    const run = activeRun()
    return run ? agentsSorted(run) : []
  })

  const detail = createMemo(() => {
    const run = activeRun()
    const agents = flatAgents()
    if (!run || agents.length === 0) return null
    const ai = clampIndex(agentIndex(), agents.length)
    const agent = agents[ai]
    if (!agent) return null
    const jmap = journalByAgent(props.journalOf(run.runId))
    return buildAgentDetail(agent, jmap.get(agent.index))
  })

  /** L2 当前 agent（按 agentIndex 选中），用于解析其 sessionID。 */
  const currentAgent = createMemo(() => {
    const agents = flatAgents()
    if (agents.length === 0) return null
    return agents[clampIndex(agentIndex(), agents.length)] ?? null
  })

  /**
   * L2 渲染缓冲区：**恒定三段式**（Prompt → Activity → Outcome）单缓冲区。
   *
   * Activity 段内容来自该 agent 的 OpenCode 会话日志（`sessionID` 已回填且已拉到时），
   * 经 {@link flattenSessionLog} 拍平后注入；尚无会话日志（无 sessionID / 加载中 / 无工具调用）
   * 时由 {@link composeAgentLines} 渲染占位文案。三段始终同框，不再因有无会话日志整页切换形态。
   */
  const agentLines = createMemo<MonitorLine[]>(() => {
    const d = detail()
    if (!d) return []
    const agent = currentAgent()
    const sid = agent?.sessionID
    const log = sid ? props.sessionLogOf(sid) : []
    const activity =
      log.length > 0
        ? { lines: flattenSessionLog(log), toolCount: countToolParts(log), placeholder: "" }
        : { lines: [], toolCount: 0, placeholder: activityPlaceholder(sid, agent?.state) }
    return composeAgentLines(d, promptExpanded(), activity)
  })

  /** 请求当前 agent 的会话日志（若有 sessionID）。 */
  function requestCurrentSession(): void {
    const sid = currentAgent()?.sessionID
    if (sid) props.requestSessionLog(sid)
  }

  /** L2 顶部面包屑：run / phase / agent。 */
  const agentHeadline = createMemo(() => {
    const run = activeRun()
    const d = detail()
    if (!run || !d) return ""
    return `${run.workflowName} / ${d.phaseTitle} / ${d.label}`
  })

  // ── 进入各层 ──
  function enterRun(): void {
    const list = runs()
    const ri = clampIndex(runIndex(), list.length)
    const run = list[ri]
    if (!run) return
    setActiveRunId(run.runId)
    props.requestJournal(run.runId)
    setPhaseIndex(0)
    setAgentIndex(0)
    setFocus("phase")
    setView("run")
  }

  function enterAgent(): void {
    const run = activeRun()
    if (!run) return
    // 把 L1 右栏选中的 agent（phaseAgents 内）映射到 flatAgents 的 index。
    const pa = phaseAgents()
    const sel = pa[clampIndex(agentIndex(), pa.length)]
    if (!sel) return
    const flat = flatAgents()
    const idx = flat.findIndex((a) => a.index === sel.index)
    setAgentIndex(idx >= 0 ? idx : 0)
    props.requestJournal(run.runId)
    // 若该 agent 已有 sessionID，请求拉取/订阅其 OpenCode 会话日志（R 第二期）。
    if (sel.sessionID) props.requestSessionLog(sel.sessionID)
    setPromptExpanded(false)
    setScrollOffset(0)
    setView("agent")
  }

  // ── 运行态控制（p/r/x/d）辅助：全部包 try/catch，绝不向上抛（Issue #13461）──

  /** toast 反馈（吞错，绝不向上抛）。 */
  function controlToast(message: string, variant: "info" | "success" | "warning" | "error"): void {
    try {
      props.api.ui.toast({ message, variant })
    } catch {
      // toast 失败静默——按键回调绝不抛。
    }
  }

  /**
   * 执行一个引擎控制动作：成功 toast okMsg 并（提供 fb 时）fire-and-forget 调用
   * `props.notifyControl(fb)` 注入运行态回执；失败 toast 错误原因（含错误码消息）。
   */
  async function runControl(
    action: () => Promise<unknown>,
    okMsg: string,
    fb?: MonitorControlFeedback,
  ): Promise<void> {
    try {
      await action()
      controlToast(okMsg, "success")
      if (fb) props.notifyControl?.(fb)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      controlToast(`操作失败：${msg}`, "error")
    }
  }

  /** 弹 DialogConfirm 二次确认，确认后执行 onYes（用于 cancel/delete 等破坏性操作）。 */
  function confirmThen(title: string, message: string, onYes: () => void): void {
    try {
      props.api.ui.dialog.replace(() =>
        props.api.ui.DialogConfirm({
          title,
          message,
          onConfirm: () => onYes(),
          onCancel: () => {},
        }),
      )
    } catch {
      // 弹框失败静默——按键回调绝不抛。
    }
  }

  /** 当前控制目标 run：L0 取高亮行，L1/L2 取激活 run。 */
  function controlTargetRun(): RunSnapshot | null {
    if (view() === "list") {
      const list = runs()
      return list[clampIndex(runIndex(), list.length)] ?? null
    }
    return activeRun()
  }

  useKeyboard((evt: KeyEvent) => {
    if (props.api.route.current.name !== MONITOR_ROUTE) return
    const name = evt.name
    const stop = () => {
      evt.preventDefault()
      evt.stopPropagation()
    }

    // 运行态控制键（p=暂停 / r=恢复 / x=终止 / d=删除）：作用于当前选中 run。
    // 守卫不满足时仅 toast 提示、不报错、不崩溃；cancel/delete 弹 DialogConfirm 二次确认。
    // 排除带 ctrl 修饰的按键，避免系统快捷键（如 Ctrl+d 退出）被误触为控制命令。
    if (!evt.ctrl && (name === "p" || name === "r" || name === "x" || name === "d")) {
      stop()
      const target = controlTargetRun()
      if (!target) return
      const engine = props.engine
      if (!engine) return // 引擎未注入（装配尚未接通）：no-op，不崩溃。
      if (name === "p") {
        if (!canPause(target.status)) {
          controlToast(`run 当前为 ${target.status}，无法暂停`, "warning")
          return
        }
        void runControl(
          () => engine.pause(target.runId),
          `已暂停 ${target.runId}`,
          { kind: "pause", runId: target.runId, workflowName: target.workflowName },
        )
      } else if (name === "r") {
        if (!canResume(target.status)) {
          controlToast(`run 当前为 ${target.status}，无法恢复`, "warning")
          return
        }
        void runControl(
          () => engine.resume(target.runId),
          `已恢复 ${target.runId}`,
          { kind: "resume", runId: target.runId, workflowName: target.workflowName },
        )
      } else if (name === "x") {
        if (!canCancel(target.status)) {
          controlToast(`run 当前为 ${target.status}，无法终止`, "warning")
          return
        }
        confirmThen("终止 Workflow", `确认终止 ${target.workflowName}（${target.runId}）？`, () => {
          void runControl(
            () => engine.cancel(target.runId),
            `已终止 ${target.runId}`,
            { kind: "cancel", runId: target.runId, workflowName: target.workflowName },
          )
        })
      } else {
        // name === "d"：仅 L0 列表层删除非 running run（R7.4）。
        if (view() !== "list") return
        if (!canDelete(target.status)) {
          controlToast(`run 当前为 ${target.status}，无法删除`, "warning")
          return
        }
        confirmThen(
          "删除 Workflow 产物",
          `确认删除 ${target.workflowName}（${target.runId}）的全部产物？此操作不可逆。`,
          () => {
            void runControl(
              () => engine.delete(target.runId),
              `已删除 ${target.runId}`,
              { kind: "delete", runId: target.runId, workflowName: target.workflowName },
            )
          },
        )
      }
      return
    }

    const v = view()
    if (v === "list") {
      if (name === "up") {
        stop()
        setRunIndex((i) => clampIndex(i - 1, runs().length))
      } else if (name === "down") {
        stop()
        setRunIndex((i) => clampIndex(i + 1, runs().length))
      } else if (name === "return") {
        stop()
        enterRun()
      } else if (name === "escape") {
        stop()
        // 关闭 Monitor：返回打开前的来源路由（工作 session），由 tui.tsx 注入。
        // 未注入时回退到 home 保底（保持旧行为，不致卡在全屏）。
        if (props.onClose) props.onClose()
        else props.api.route.navigate("home")
      }
      return
    }

    if (v === "run") {
      if (name === "right" || name === "left") {
        stop()
        setFocus((f) => (f === "phase" ? "agent" : "phase"))
      } else if (name === "up") {
        stop()
        if (focus() === "phase")
          setPhaseIndex((i) => {
            const next = clampIndex(i - 1, groups().length)
            setAgentIndex(0)
            return next
          })
        else setAgentIndex((i) => clampIndex(i - 1, phaseAgents().length))
      } else if (name === "down") {
        stop()
        if (focus() === "phase")
          setPhaseIndex((i) => {
            const next = clampIndex(i + 1, groups().length)
            setAgentIndex(0)
            return next
          })
        else setAgentIndex((i) => clampIndex(i + 1, phaseAgents().length))
      } else if (name === "return") {
        stop()
        if (focus() === "agent") enterAgent()
        else setFocus("agent")
      } else if (name === "escape") {
        stop()
        setView("list")
      }
      return
    }

    // v === "agent"
    if (name === "up") {
      stop()
      setAgentIndex((i) => clampIndex(i - 1, flatAgents().length))
      setScrollOffset(0)
      setPromptExpanded(false)
      requestCurrentSession()
    } else if (name === "down") {
      stop()
      setAgentIndex((i) => clampIndex(i + 1, flatAgents().length))
      setScrollOffset(0)
      setPromptExpanded(false)
      requestCurrentSession()
    } else if (name === "j") {
      stop()
      setScrollOffset((o) => o + 1)
    } else if (name === "k") {
      stop()
      setScrollOffset((o) => Math.max(0, o - 1))
    } else if (name === "g") {
      // FIX-11: g 跳顶部；Shift+G 跳底部
      stop()
      if (evt.shift) {
        const maxOffset = Math.max(0, agentLines().length - Math.max(4, dim().height - 8))
        setScrollOffset(maxOffset)
      } else {
        setScrollOffset(0)
      }
    } else if (name === "e") {
      stop()
      setPromptExpanded((x) => !x)
    } else if (evt.name === "pageup") {
      // FIX-11: PageUp 半屏向上
      stop()
      setScrollOffset((o) => Math.max(0, o - Math.floor(dim().height / 2)))
    } else if (evt.name === "pagedown") {
      // FIX-11: PageDown 半屏向下
      stop()
      setScrollOffset((o) => o + Math.floor(dim().height / 2))
    } else if (name === "escape") {
      stop()
      setView("run")
    }
  }, {})

  // ── 渲染 ──
  return (
    <box
      width={dim().width}
      height={dim().height}
      backgroundColor={theme().background}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
    >
      <Show when={view() === "list"}>
        <ListView
          rows={runs().map(toListRow)}
          selected={clampIndex(runIndex(), runs().length)}
          theme={theme()}
          onSelect={(i) => {
            setRunIndex(i)
            enterRun()
          }}
        />
      </Show>

      <Show when={view() === "run" && activeRun()}>
        <RunView
          run={activeRun() as RunSnapshot}
          groups={groups()}
          phaseIndex={clampIndex(phaseIndex(), groups().length)}
          agentIndex={clampIndex(agentIndex(), phaseAgents().length)}
          phaseAgents={phaseAgents()}
          focus={focus()}
          theme={theme()}
          onPickPhase={(i) => {
            setPhaseIndex(i)
            setAgentIndex(0)
            setFocus("phase")
          }}
          onPickAgent={(i) => {
            setAgentIndex(i)
            setFocus("agent")
            enterAgent()
          }}
        />
      </Show>

      <Show when={view() === "agent" && detail()}>
        <AgentView
          run={activeRun() as RunSnapshot}
          headline={agentHeadline()}
          lines={agentLines()}
          scrollOffset={scrollOffset()}
          viewportHeight={Math.max(4, dim().height - 8)}
          theme={theme()}
        />
      </Show>
    </box>
  )
}

// ============================================================================
// L0 列表
// ============================================================================

function ListView(props: {
  rows: ReturnType<typeof toListRow>[]
  selected: number
  theme: Theme
  onSelect: (i: number) => void
}): JSX.Element {
  return (
    <box flexDirection="column">
      <text fg={props.theme.accent}>{`Workflow Monitor    ${props.rows.length} runs`}</text>
      <text fg={props.theme.borderSubtle}>{"─".repeat(60)}</text>

      <Show when={props.rows.length === 0}>
        <text fg={props.theme.textMuted}>（暂无 workflow 运行记录）</text>
      </Show>

      <For each={props.rows}>
        {(row, i) => {
          const on = () => i() === props.selected
          const meta = `${row.agentCount} agents · ${formatTokens(row.totalTokens)} tok · ${formatDuration(row.durationMs)}`
          // 区分同名 run：需求标签（智能提取）+ runId 短前缀 + 启动时间。
          const label = deriveRunLabel(row.label)
          const ident = `${label ? `「${label}」 · ` : ""}${shortRunId(row.runId)} · ${formatClockTime(row.startTime)}`
          return (
            <box onMouseDown={() => props.onSelect(i())}>
              <text fg={on() ? props.theme.accent : statusColor(row.status, props.theme)}>
                {`${on() ? ">" : " "} ${statusIcon(row.status)} ${row.workflowName} ${ident}  [${row.status}]   ${meta}`}
              </text>
            </box>
          )
        }}
      </For>

      <text fg={props.theme.borderSubtle}>{"─".repeat(60)}</text>
      {/* FIX-4: 控制状态行 — 显示当前选中 run 的 status 和控制快捷键 */}
      <Show when={props.rows.length > 0}>
        <text fg={props.theme.textMuted}>
          {`状态: ${props.rows[props.selected]?.status ?? "—"}  ·  `}
          ↑/↓ 选择 · Enter 进入 · p 暂停 · r 恢复 · x 终止 · d 删除 · Esc 关闭
        </text>
      </Show>
      <Show when={props.rows.length === 0}>
        <text fg={props.theme.textMuted}>↑/↓ 选择 · Enter 进入 · Esc 关闭</text>
      </Show>
    </box>
  )
}

// ============================================================================
// L1 phases 双栏
// ============================================================================

function RunView(props: {
  run: RunSnapshot
  groups: ReturnType<typeof phaseGroups>
  phaseIndex: number
  agentIndex: number
  phaseAgents: ReturnType<typeof phaseGroups>[number]["agents"]
  focus: RunFocus
  theme: Theme
  onPickPhase: (i: number) => void
  onPickAgent: (i: number) => void
}): JSX.Element {
  const t = props.theme
  const doneAgents = () => props.run.workflowProgress.filter((e) => e.type === "workflow_agent" && e.state === "done").length
  const totalAgents = () => props.run.workflowProgress.filter((e) => e.type === "workflow_agent").length
  const summary = `${doneAgents()}/${totalAgents()} agents · ${formatDuration(props.run.durationMs)} · ${props.run.status}`

  return (
    <box flexDirection="column">
      <text fg={statusColor(props.run.status, t)}>{`${props.run.workflowName}    ${summary}`}</text>
      <text fg={t.borderSubtle}>{"─".repeat(60)}</text>

      <box flexDirection="row">
        {/* 左栏：phases */}
        <box flexDirection="column" width={26} paddingRight={1}>
          <text fg={t.textMuted}>Phases</text>
          <For each={props.groups}>
            {(g, i) => {
              const on = () => i() === props.phaseIndex
              const focused = () => on() && props.focus === "phase"
              return (
                <box onMouseDown={() => props.onPickPhase(i())}>
                  <text fg={focused() ? t.accent : on() ? t.text : t.textMuted}>
                    {`${focused() ? ">" : " "} ${g.phase}  ${g.done}/${g.total}`}
                  </text>
                </box>
              )
            }}
          </For>
        </box>

        {/* 右栏：选中阶段的 agents */}
        <box flexDirection="column" flexGrow={1}>
          <text fg={t.textMuted}>{`${props.groups[props.phaseIndex]?.phase ?? "—"} · ${props.phaseAgents.length} agents`}</text>
          <For each={props.phaseAgents}>
            {(a, i) => {
              const on = () => i() === props.agentIndex && props.focus === "agent"
              const meta = `${a.model || "—"} · ${formatTokens(a.tokens)} tok · ${formatDuration(a.durationMs)}`
              return (
                <box onMouseDown={() => props.onPickAgent(i())}>
                  <text fg={on() ? t.accent : t.text}>
                    {`${on() ? ">" : " "} ${agentStateIcon(a.state)} ${a.label}    ${meta}`}
                  </text>
                </box>
              )
            }}
          </For>
        </box>
      </box>

      <text fg={t.borderSubtle}>{"─".repeat(60)}</text>
      {/* FIX-4: 控制状态行 — 显示当前 run 的运行态 + 控制快捷键 */}
      <text fg={statusColor(props.run.status, t)}>{`⏱ 状态: ${props.run.status}`}</text>
      <text fg={t.textMuted}>↑/↓ 选择 · ←/→ 切栏 · Enter 看 agent · p 暂停 · r 恢复 · x 终止 · Esc 返回</text>
    </box>
  )
}

// ============================================================================
// L2 agent 详情
// ============================================================================

function AgentView(props: {
  run: RunSnapshot
  headline: string
  lines: MonitorLine[]
  scrollOffset: number
  viewportHeight: number
  theme: Theme
}): JSX.Element {
  const t = props.theme

  // 单一缓冲区（元信息 + 会话日志 / 或 journal 详情），套单一滚动窗口——杜绝溢出叠绘。
  const win = () => scrollWindow(props.lines.length, props.scrollOffset, props.viewportHeight)
  const shown = () => {
    const w = win()
    return props.lines.slice(w.from, w.to)
  }

  const toneColor = (tone: LineTone) => {
    switch (tone) {
      case "title":
        return t.accent
      case "meta":
        return statusColor(props.run.status, t)
      case "section":
        return t.accent
      case "divider":
        return t.borderSubtle
      case "muted":
        return t.textMuted
      case "body":
        return t.text
    }
  }

  return (
    <box flexDirection="column">
      <text fg={t.accent}>{props.headline}</text>
      {/* FIX-4: 控制状态行 — 显示当前 run 的运行态 */}
      <text fg={statusColor(props.run.status, t)}>{`⏱ 状态: ${props.run.status}`}</text>
      <text fg={t.borderSubtle}>{"─".repeat(60)}</text>

      <For each={shown()}>{(line) => <text fg={toneColor(line.tone)}>{line.text}</text>}</For>

      <text fg={t.borderSubtle}>{"─".repeat(60)}</text>
      <Show when={props.lines.length > props.viewportHeight}>
        <text fg={t.textMuted}>{`${win().from + 1}-${win().to} of ${props.lines.length}  ·  j/k 滚动 · g/Shift+G 顶/底 · PgUp/PgDn 翻页`}</text>
      </Show>
      <text fg={t.textMuted}>↑/↓ 切 agent · j/k 滚动 · g/Shift+G 顶/底 · PgUp/PgDn 翻页 · e 展开 prompt · p 暂停 · r 恢复 · x 终止 · Esc 返回</text>
    </box>
  )
}
