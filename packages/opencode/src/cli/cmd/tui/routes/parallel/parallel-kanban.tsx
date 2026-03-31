import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { For, Show, createMemo, createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { pipe, sumBy } from "remeda"
import type { Plan, WorkerState } from "@/parallel/schema"
import { formatCost, formatDuration, statusIcon, statusLabel } from "./helpers"

type Lane = "pending" | "running" | "done" | "failed"

function lane(status: WorkerState["status"]): Lane {
  if (status === "running" || status === "spawning" || status === "stopping") return "running"
  if (status === "done" || status === "merged") return "done"
  if (status === "failed" || status === "conflict") return "failed"
  return "pending"
}

function tone(theme: ReturnType<typeof useTheme>["theme"], item: Lane) {
  switch (item) {
    case "running":
      return theme.warning
    case "done":
      return theme.success
    case "failed":
      return theme.error
    default:
      return theme.border
  }
}

export function ParallelKanban(props: { plan: Plan; onBack?: () => void }) {
  const { theme } = useTheme()
  const dim = useTerminalDimensions()
  const sync = useSync()
  const route = useRoute()
  const [col, setCol] = createSignal(0)
  const [row, setRow] = createSignal(0)
  const cols = ["pending", "running", "done", "failed"] as const
  const icons = {
    pending: "○",
    running: "●",
    done: "✓",
    failed: "✗",
  } as const
  const labels = {
    pending: "Pending",
    running: "Running",
    done: "Done",
    failed: "Failed",
  } as const
  const width = () => Math.min(120, dim().width - 2)
  const height = () => Math.max(12, dim().height - 4)
  const colW = () => Math.max(24, Math.floor((width() - 5) / 4))
  const start = props.plan.time.approved ?? props.plan.time.created

  const data = createMemo(() =>
    props.plan.workers.map((worker) => {
      const subtask = props.plan.subtasks.find((item) => item.id === worker.subtaskID)
      const msgs = worker.sessionID ? (sync.data.message[worker.sessionID] ?? []) : []
      const cost = pipe(
        msgs,
        sumBy((msg) => (msg.role === "assistant" ? msg.cost ?? 0 : 0)),
      )
      return {
        worker,
        subtask,
        cost,
        lane: lane(worker.status),
        model: subtask?.model?.modelID ?? props.plan.workerModel.modelID,
      }
    }),
  )

  const lanes = createMemo(() =>
    Object.fromEntries(cols.map((key) => [key, data().filter((item) => item.lane === key)])) as Record<
      (typeof cols)[number],
      ReturnType<typeof data>
    >,
  )

  const item = createMemo(() => lanes()[cols[col()]]?.[row()])
  const done = () => props.plan.workers.filter((worker) => worker.status === "done" || worker.status === "merged").length
  const run = () => props.plan.workers.filter((worker) => worker.status === "running" || worker.status === "spawning").length
  const fail = () => props.plan.workers.filter((worker) => worker.status === "failed" || worker.status === "conflict").length

  const fix = (nextCol: number, nextRow: number) => {
    const key = cols[Math.max(0, Math.min(cols.length - 1, nextCol))]
    const max = Math.max(0, lanes()[key].length - 1)
    setCol(cols.indexOf(key))
    setRow(Math.max(0, Math.min(max, nextRow)))
  }

  useKeyboard((evt) => {
    if (evt.defaultPrevented) return
    if (evt.name === "left" || evt.sequence === "h") {
      evt.preventDefault()
      evt.stopPropagation()
      fix(col() - 1, row())
      return
    }
    if (evt.name === "right" || evt.sequence === "l") {
      evt.preventDefault()
      evt.stopPropagation()
      fix(col() + 1, row())
      return
    }
    if (evt.name === "up" || evt.sequence === "k") {
      evt.preventDefault()
      evt.stopPropagation()
      fix(col(), row() - 1)
      return
    }
    if (evt.name === "down" || evt.sequence === "j") {
      evt.preventDefault()
      evt.stopPropagation()
      fix(col(), row() + 1)
      return
    }
    if (evt.name === "return" || evt.name === "enter") {
      if (!item()?.worker.sessionID) return
      evt.preventDefault()
      evt.stopPropagation()
      route.navigate({ type: "session", sessionID: item()!.worker.sessionID! })
      return
    }
    if (evt.name === "escape") {
      props.onBack?.()
    }
  })

  return (
    <box width={width()} height={height()} backgroundColor={theme.backgroundPanel} padding={1} flexDirection="column">
      <box flexDirection="row" gap={2} marginBottom={1}>
        <text attributes={TextAttributes.BOLD} fg={theme.primary}>
          Kanban
        </text>
        <text fg={theme.text}>
          {done()}/{props.plan.workers.length} complete
        </text>
        <Show when={run() > 0}>
          <text fg={theme.warning}>{run()} running</text>
        </Show>
        <Show when={fail() > 0}>
          <text fg={theme.error}>{fail()} failed</text>
        </Show>
        <text fg={theme.textMuted}>{formatDuration(Date.now() - start)}</text>
      </box>

      <scrollbox
        height={height() - 6}
        width={width() - 2}
        verticalScrollbarOptions={{
          paddingLeft: 1,
          trackOptions: {
            backgroundColor: theme.backgroundElement,
            foregroundColor: theme.border,
          },
        }}
      >
        <box flexDirection="row" gap={1}>
          <For each={cols}>
            {(key, idx) => (
              <box
                width={colW()}
                flexDirection="column"
                borderStyle="rounded"
                borderColor={tone(theme, key)}
                padding={1}
                gap={1}
              >
                <box flexDirection="row" gap={1}>
                  <text fg={tone(theme, key)}>{icons[key]}</text>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    {labels[key]}
                  </text>
                  <text fg={theme.textMuted}>({lanes()[key].length})</text>
                </box>

                <For each={lanes()[key]}>
                  {(card, jdx) => (
                    <box
                      flexDirection="column"
                      borderStyle="single"
                      borderColor={col() === idx() && row() === jdx() ? theme.primary : theme.border}
                      backgroundColor={col() === idx() && row() === jdx() ? theme.backgroundElement : theme.background}
                      padding={1}
                      gap={0}
                    >
                      <text fg={tone(theme, key)} wrapMode="word">
                        {statusIcon(card.worker.status)} {card.subtask?.title?.slice(0, colW() - 6) ?? "Unknown"}
                      </text>
                      <text fg={theme.textMuted}>{card.model}</text>
                      <box flexDirection="row" gap={1}>
                        <text fg={theme.accent}>{formatCost(card.cost)}</text>
                        <Show when={card.subtask?.dependencies.length}>
                          <text fg={theme.textMuted}>{card.subtask!.dependencies.length} deps</text>
                        </Show>
                      </box>
                      <Show when={card.worker.error}>
                        <text fg={theme.error} wrapMode="word">
                          {card.worker.error!.slice(0, colW() - 4)}
                        </text>
                      </Show>
                    </box>
                  )}
                </For>

                <Show when={lanes()[key].length === 0}>
                  <text fg={theme.textMuted}>No cards</text>
                </Show>
              </box>
            )}
          </For>
        </box>
      </scrollbox>

      <Show when={item()}>
        {(card) => (
          <box marginTop={1} flexDirection="row" gap={2}>
            <text fg={tone(theme, card().lane)}>{statusLabel(card().worker)}</text>
            <text fg={theme.text}>{card().subtask?.title ?? "Unknown"}</text>
          </box>
        )}
      </Show>

      <box marginTop={1}>
        <text fg={theme.textMuted}>arrows move | enter open session | v view | esc back</text>
      </box>
    </box>
  )
}
