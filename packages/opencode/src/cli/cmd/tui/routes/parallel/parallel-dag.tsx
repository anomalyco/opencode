import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { For, Show, createMemo, createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { Plan } from "@/parallel/schema"
import { layoutDAG } from "./dag-layout"
import { formatDuration, statusIcon, statusLabel } from "./helpers"

function tone(theme: ReturnType<typeof useTheme>["theme"], status: Plan["workers"][number]["status"]) {
  switch (status) {
    case "running":
      return theme.warning
    case "done":
    case "merged":
      return theme.success
    case "failed":
    case "conflict":
      return theme.error
    case "spawning":
      return theme.accent
    default:
      return theme.border
  }
}

function mark(
  grid: number[][],
  x: number,
  y: number,
  dir: number,
) {
  const row = grid[y]
  if (!row) return
  if (x < 0 || x >= row.length) return
  row[x] |= dir
}

function draw(input: ReturnType<typeof layoutDAG>) {
  const grid = Array.from({ length: input.height }, () => Array.from({ length: input.width }, () => 0))
  const U = 1
  const D = 2
  const L = 4
  const R = 8

  for (const edge of input.edges) {
    for (let i = 0; i < edge.points.length - 1; i++) {
      const a = edge.points[i]
      const b = edge.points[i + 1]
      if (a.x === b.x) {
        const [top, bot] = a.y <= b.y ? [a.y, b.y] : [b.y, a.y]
        for (let y = top; y < bot; y++) {
          mark(grid, a.x, y, D)
          mark(grid, a.x, y + 1, U)
        }
        continue
      }
      if (a.y === b.y) {
        const [left, right] = a.x <= b.x ? [a.x, b.x] : [b.x, a.x]
        for (let x = left; x < right; x++) {
          mark(grid, x, a.y, R)
          mark(grid, x + 1, a.y, L)
        }
      }
    }
  }

  const char = (bits: number) => {
    if (bits === 0) return " "
    if (bits === (L | R)) return "─"
    if (bits === (U | D)) return "│"
    if (bits === (D | R)) return "┌"
    if (bits === (D | L)) return "┐"
    if (bits === (U | R)) return "└"
    if (bits === (U | L)) return "┘"
    if (bits === (U | D | R)) return "├"
    if (bits === (U | D | L)) return "┤"
    if (bits === (D | L | R)) return "┬"
    if (bits === (U | L | R)) return "┴"
    return "┼"
  }

  return grid.map((row) => row.map(char).join("")).join("\n")
}

export function ParallelDAG(props: { plan: Plan; onBack?: () => void }) {
  const { theme } = useTheme()
  const dim = useTerminalDimensions()
  const route = useRoute()
  const [sel, setSel] = createSignal(0)
  const width = () => Math.min(120, dim().width - 2)
  const height = () => Math.max(12, dim().height - 4)
  const lay = createMemo(() =>
    layoutDAG({
      subtasks: props.plan.subtasks,
      workers: props.plan.workers,
      cols: Math.max(60, width() - 6),
      rows: Math.max(24, height() - 8),
    }),
  )
  const list = createMemo(() =>
    lay()
      .nodes
      .map((item) => ({
        ...item,
        worker: props.plan.workers.find((worker) => worker.subtaskID === item.id),
        subtask: props.plan.subtasks.find((subtask) => subtask.id === item.id),
      }))
      .sort((a, b) => a.layer - b.layer || a.row - b.row),
  )
  const item = createMemo(() => list()[sel()])
  const text = createMemo(() => draw(lay()))
  const done = () => props.plan.workers.filter((worker) => worker.status === "done" || worker.status === "merged").length
  const run = () => props.plan.workers.filter((worker) => worker.status === "running" || worker.status === "spawning").length
  const fail = () => props.plan.workers.filter((worker) => worker.status === "failed" || worker.status === "conflict").length
  const start = props.plan.time.approved ?? props.plan.time.created

  const move = (dx: number, dy: number) => {
    const cur = item()
    if (!cur) return
    const next = list()
      .filter((node) => {
        if (dx < 0 && node.layer >= cur.layer) return false
        if (dx > 0 && node.layer <= cur.layer) return false
        if (dy < 0 && node.row >= cur.row) return false
        if (dy > 0 && node.row <= cur.row) return false
        return node.id !== cur.id
      })
      .sort((a, b) => {
        const da = Math.abs(a.layer - cur.layer) * 10 + Math.abs(a.row - cur.row)
        const db = Math.abs(b.layer - cur.layer) * 10 + Math.abs(b.row - cur.row)
        return da - db
      })[0]
    if (!next) return
    const idx = list().findIndex((node) => node.id === next.id)
    if (idx >= 0) setSel(idx)
  }

  useKeyboard((evt) => {
    if (evt.defaultPrevented) return
    if (evt.name === "left" || evt.sequence === "h") {
      evt.preventDefault()
      evt.stopPropagation()
      move(-1, 0)
      return
    }
    if (evt.name === "right" || evt.sequence === "l") {
      evt.preventDefault()
      evt.stopPropagation()
      move(1, 0)
      return
    }
    if (evt.name === "up" || evt.sequence === "k") {
      evt.preventDefault()
      evt.stopPropagation()
      move(0, -1)
      return
    }
    if (evt.name === "down" || evt.sequence === "j") {
      evt.preventDefault()
      evt.stopPropagation()
      move(0, 1)
      return
    }
    if (evt.name === "return" || evt.name === "enter") {
      const worker = item()?.worker
      if (!worker?.sessionID) return
      evt.preventDefault()
      evt.stopPropagation()
      route.navigate({ type: "session", sessionID: worker.sessionID })
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
          DAG
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

      <Show when={item()}>
        {(node) => (
          <box flexDirection="row" gap={2} marginBottom={1}>
            <text fg={tone(theme, node().status)}>{statusIcon(node().status)}</text>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {node().title}
            </text>
            <text fg={theme.textMuted}>{statusLabel(node().worker ?? { status: node().status })}</text>
            <Show when={node().subtask?.dependencies.length}>
              <text fg={theme.textMuted}>{node().subtask!.dependencies.length} deps</text>
            </Show>
          </box>
        )}
      </Show>

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
        <box width={lay().width + 2} height={lay().height + 1}>
          <text position="absolute" top={0} left={0} fg={theme.border}>
            {text()}
          </text>
          <For each={list()}>
            {(node, index) => (
              <box
                position="absolute"
                top={node.y}
                left={node.x}
                width={node.w}
                height={node.h}
                borderStyle="rounded"
                borderColor={index() === sel() ? theme.primary : tone(theme, node.status)}
                backgroundColor={index() === sel() ? theme.backgroundElement : theme.background}
                paddingLeft={1}
                paddingRight={1}
                justifyContent="center"
              >
                <text fg={tone(theme, node.status)}>
                  {statusIcon(node.status)} {node.title.slice(0, Math.max(8, node.w - 4))}
                </text>
                <Show when={node.subtask?.dependencies.length}>
                  <text fg={theme.textMuted}>{node.subtask!.dependencies.length} deps</text>
                </Show>
              </box>
            )}
          </For>
        </box>
      </scrollbox>

      <box marginTop={1}>
        <text fg={theme.textMuted}>arrows move | enter open session | v view | esc back</text>
      </box>
    </box>
  )
}
