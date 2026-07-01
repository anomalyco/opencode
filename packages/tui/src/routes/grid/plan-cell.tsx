import { For, Match, Show, Switch, createMemo } from "solid-js"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { useGrid } from "../../context/grid"
import { TuiPluginRuntime } from "../../plugin"
import { AgentStatus } from "../../component/agent-status"
import { PlanSummary } from "../../component/plan-summary"
import { getScrollAcceleration } from "../../util/scroll"
import type { GridCell } from "../../context/grid-persistence"

export interface PlanCellProps {
  /**
   * The grid cell this dashboard renders for. The component is intentionally
   * prop-driven so the grid layout can mount/unmount it freely without the
   * dashboard reaching into route state.
   */
  cell: GridCell
}

/**
 * Read-only plan dashboard for a single grid cell.
 *
 * The view reuses the existing sidebar plugin slots (`sidebar_title`,
 * `sidebar_content`, `sidebar_footer`) so it stays in lockstep with the
 * regular session sidebar — every plugin (cwd, instructions, context, MCP,
 * LSP, goal, todo, task, files, footer) renders here without duplication.
 * `PlanSummary` and `AgentStatus` add full-width aggregations that are not
 * appropriate in the 42-col sidebar.
 *
 * No prompt input, no message scrollbox — toggling `cell.mode` between
 * `"full"` and `"plan-only"` flips the grid route between this dashboard and
 * `SessionCell` without a layout re-mount.
 *
 * Reactivity flows from the sync store: every Solid signal consumed here is a
 * slice of `sync.data.*`, so sync events re-render automatically. No manual
 * timers, intervals, or imperative refresh hooks.
 */
export function PlanCell(props: PlanCellProps) {
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const grid = useGrid()

  const sessionID = () => props.cell.sessionID

  // Resolve the reactive session row once — every downstream accessor depends
  // on it, so caching the memo keeps the rest of the render cheap.
  const session = createMemo(() => sync.session.get(sessionID()))

  // Slice out the buckets the dashboard cares about. Each `createMemo` is
  // independent: changing tasks does not invalidate the diff render and vice
  // versa. Fall back to empty arrays / `undefined` so unmounted sessions keep
  // rendering gracefully instead of throwing.
  const tasks = createMemo(() => sync.data.task[sessionID()] ?? [])
  const todos = createMemo(() => sync.data.todo[sessionID()] ?? [])
  const diff = createMemo(() => sync.data.session_diff[sessionID()] ?? [])
  const actors = createMemo(() => sync.data.actor[sessionID()] ?? [])

  const cwd = createMemo(() => sync.data.session_cwd[sessionID()])
  const goal = createMemo(() => sync.data.session_goal[sessionID()])
  const status = createMemo(() => sync.data.session_status[sessionID()])

  const diffTotals = createMemo(() => {
    let adds = 0
    let dels = 0
    for (const item of diff()) {
      adds += item.additions
      dels += item.deletions
    }
    return { adds, dels, count: diff().length }
  })

  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        flexGrow={1}
        flexShrink={1}
        height="100%"
        width="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="column"
        onMouseUp={() => {
          if (grid.activeCellId !== props.cell.id) {
            grid.setActive(props.cell.id)
          }
        }}
      >
        <scrollbox
          flexGrow={1}
          flexShrink={1}
          scrollAcceleration={scrollAcceleration()}
          onMouseUp={() => {
            if (grid.activeCellId !== props.cell.id) {
              grid.setActive(props.cell.id)
            }
          }}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1} flexDirection="column">
            <Header sessionID={sessionID()} cwd={cwd()} statusType={status()?.type} />

            <PlanSummary tasks={tasks()} todos={todos()} />

            <AgentStatus actors={actors()} />

            <FilesSection totals={diffTotals()} entries={diff()} />

            <GoalSection goal={goal()} />

            {/* Reuse the sidebar plugin slots in full-width — cwd, instructions,
                context, MCP, LSP, todo, task, files, footer all render here
                via the same plugin registry as the regular session sidebar. */}
            <TuiPluginRuntime.Slot name="sidebar_content" session_id={sessionID()} />
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <TuiPluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={sessionID()}>
            <text fg={theme.textMuted}>
              plan-only · <span style={{ fg: theme.text }}>{props.cell.label}</span>
            </text>
          </TuiPluginRuntime.Slot>
        </box>
      </box>
    </Show>
  )
}

function Header(props: { sessionID: string; cwd: string | undefined; statusType: string | undefined }) {
  const sync = useSync()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const statusLabel = () => {
    const t = props.statusType
    if (t === "busy") return "working"
    if (t === "retry") return "retrying"
    return "idle"
  }
  const statusColor = () => {
    const t = props.statusType
    if (t === "busy") return theme.warning
    if (t === "retry") return theme.error
    return theme.success
  }
  return (
    <box flexDirection="column" gap={0} paddingBottom={1}>
      <box flexDirection="row" gap={1} justifyContent="space-between">
        <TuiPluginRuntime.Slot
          name="sidebar_title"
          mode="single_winner"
          session_id={props.sessionID}
          title={session()?.title ?? ""}
          share_url={session()?.share?.url}
        >
          <text fg={theme.text}>
            <b>{session()?.title ?? "Session"}</b>
          </text>
        </TuiPluginRuntime.Slot>
        <text flexShrink={0} fg={statusColor()}>
          {statusLabel()}
        </text>
      </box>
      <Show when={props.cwd}>
        <text fg={theme.textMuted} wrapMode="none">
          {props.cwd}
        </text>
      </Show>
    </box>
  )
}

function FilesSection(props: {
  totals: { adds: number; dels: number; count: number }
  entries: { file: string; additions: number; deletions: number }[]
}) {
  const { theme } = useTheme()
  return (
    <Show when={props.totals.count > 0}>
      <box flexDirection="column" gap={0}>
        <box flexDirection="row" gap={1} justifyContent="space-between">
          <text fg={theme.text}>
            <b>Modified Files</b>
          </text>
          <text flexShrink={0} fg={theme.textMuted}>
            <span style={{ fg: theme.diffAdded }}>+{props.totals.adds}</span>
            <span> </span>
            <span style={{ fg: theme.diffRemoved }}>-{props.totals.dels}</span>
            <span>
              {" "}
              · {props.totals.count} file{props.totals.count === 1 ? "" : "s"}
            </span>
          </text>
        </box>
        <For each={props.entries}>
          {(item) => (
            <box flexDirection="row" gap={1} justifyContent="space-between">
              <text fg={theme.textMuted} wrapMode="none">
                {item.file}
              </text>
              <box flexDirection="row" gap={1} flexShrink={0}>
                <Show when={item.additions}>
                  <text fg={theme.diffAdded}>+{item.additions}</text>
                </Show>
                <Show when={item.deletions}>
                  <text fg={theme.diffRemoved}>-{item.deletions}</text>
                </Show>
              </box>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

function GoalSection(props: {
  goal:
    | {
        condition?: string
        verdicts: Record<
          string,
          { ok: boolean; impossible?: boolean; reason: string; attempt: number; error?: boolean }
        >
        lastMessageID?: string
      }
    | undefined
}) {
  const { theme } = useTheme()
  const condition = createMemo(() => props.goal?.condition)
  const verdict = createMemo(() => {
    const g = props.goal
    if (!g?.lastMessageID) return undefined
    return g.verdicts[g.lastMessageID]
  })
  const status = createMemo(() => {
    const v = verdict()
    if (!v) return undefined
    if (v.error) return { dot: theme.textMuted, label: "error (stopped)" }
    if (v.ok) return { dot: theme.success, label: "met" }
    if (v.impossible) return { dot: theme.error, label: "impossible" }
    return { dot: theme.warning, label: `round ${v.attempt} · not met` }
  })
  const visible = createMemo(() => Boolean(condition() || status()))
  return (
    <Show when={visible()}>
      <box flexDirection="column" gap={0}>
        <text fg={theme.text}>
          <b>Goal</b>
        </text>
        <Show when={condition()}>
          <box flexDirection="row" gap={1}>
            <text flexShrink={0} fg={theme.primary}>
              •
            </text>
            <text fg={theme.textMuted} wrapMode="word">
              {condition()}
            </text>
          </box>
        </Show>
        <Switch>
          <Match when={status()}>
            {(s) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} fg={s().dot}>
                  •
                </text>
                <text fg={theme.textMuted} wrapMode="word">
                  Judge: {s().label}
                </text>
              </box>
            )}
          </Match>
        </Switch>
      </box>
    </Show>
  )
}
