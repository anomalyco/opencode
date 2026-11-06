/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- the spec parser and the read function above clamp every numeric field; these assertions only pick the branch the data already selected. */
import { createMemo, For, Show } from "solid-js"
import { bool, num, object, objects, optionalStr, str } from "../json"
import { short } from "../format"
import { Readout } from "../controls"
import { VisualFrame } from "../frame"
import type { VisualSpec } from "../spec"

const W = 680

const H = 210

type Symbol = "source" | "pump" | "valve" | "filter" | "tank" | "heat" | "machine" | "sensor" | "sink"

interface Node {
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly symbol: Symbol
  readonly x: number
  readonly y: number
  readonly active: boolean
}

interface ScreenPoint {
  readonly x: number
  readonly y: number
}

interface Edge {
  readonly from: string
  readonly to: string
  readonly label?: string
  readonly flow: boolean
}

function readNodes(data: ReturnType<typeof object>): Node[] {
  const raw = objects(data?.nodes)
    .slice(0, 12)
    .map((item, index) => ({
      id: str(item.id, `n${index}`),
      label: str(item.label, `Unit ${index + 1}`),
      detail: optionalStr(item.detail),
      symbol: str(item.type, "machine") as Symbol,
      x: num(item.x, Number.NaN),
      y: num(item.y, Number.NaN),
      active: bool(item.active, false),
    }))

  if (raw.length === 0) return raw
  const edges = objects(data?.edges)
  const ids = new Set(raw.map((item) => item.id))
  const incoming = new Map<string, string[]>()
  raw.forEach((item) => incoming.set(item.id, []))
  edges.forEach((edge) => {
    const from = str(edge.from, "")
    const to = str(edge.to, "")

    if (ids.has(from) && ids.has(to)) incoming.get(to)?.push(from)
  })
  const level = new Map<string, number>()

  const visit = (id: string, depth: number, seen: Set<string>): number => {
    if (seen.has(id)) return 0
    seen.add(id)
    const parents = incoming.get(id) ?? []
    const value = parents.length === 0 ? 0 : Math.max(...parents.map((parent) => visit(parent, depth + 1, seen))) + 1
    level.set(id, Math.max(level.get(id) ?? 0, value))

    return value
  }

  raw.forEach((item) => visit(item.id, 0, new Set()))
  const levels = Math.max(1, ...raw.map((item) => level.get(item.id) ?? 0))
  const columns = new Map<number, string[]>()
  raw.forEach((item) => {
    const index = level.get(item.id) ?? 0
    columns.set(index, [...(columns.get(index) ?? []), item.id])
  })

  return raw.map((item, index) => {
    const indexLevel = level.get(item.id) ?? 0
    const column = columns.get(indexLevel) ?? [item.id]
    const order = column.indexOf(item.id)

    return {
      ...item,
      x: Number.isFinite(item.x) ? item.x : levels === 0 ? 0.5 : indexLevel / levels,
      y: Number.isFinite(item.y) ? item.y : column.length === 1 ? 0.5 : 0.18 + (order / Math.max(1, column.length - 1)) * 0.64,
      symbol: normalize(item.symbol, index),
    }
  })
}

function normalize(value: string, index: number): Symbol {
  const known: Symbol[] = ["source", "pump", "valve", "filter", "tank", "heat", "machine", "sensor", "sink"]

  if (known.includes(value as Symbol)) return value as Symbol

  if (index === 0) return "source"

  return "machine"
}

export function FlowVisual(props: { spec: VisualSpec }) {
  const data = () => object(props.spec.data) ?? {}
  const nodes = createMemo(() => readNodes(data()))

  const edges = createMemo<Edge[]>(() => {
    const ids = new Set(nodes().map((node) => node.id))

    return objects(data().edges)
      .slice(0, 20)
      .map((item) => ({
        from: str(item.from, ""),
        to: str(item.to, ""),
        label: optionalStr(item.label),
        flow: bool(item.flow, true),
      }))
      .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
  })

  const point = (node: Node): ScreenPoint => ({ x: 70 + node.x * (W - 140), y: 42 + node.y * (H - 96) })

  return (
    <VisualFrame
      spec={props.spec}
     
      stage={
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.spec.title}>
          <defs>
            <marker id="vz-flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path class="vz-arrow" d="M0 0 8 4 0 8Z" />
            </marker>
          </defs>
          <For each={edges()}>
            {(edge) => {
              const from = () => nodes().find((node) => node.id === edge.from)
              const to = () => nodes().find((node) => node.id === edge.to)

              return (
                <Show when={from() && to()}>
                  {(() => {
                    const a = point(from()!)
                    const b = point(to()!)
                    const mid = (a.x + b.x) / 2
                    const back = b.x < a.x
                    const end = back ? { x: b.x, y: b.y + 16 } : { x: b.x - Math.sign(b.x - a.x) * 15, y: b.y }

                    const d = back
                      ? `M${a.x},${a.y + 14} V${H - 30} H${end.x} V${end.y}`
                      : `M${a.x},${a.y} H${mid} V${end.y} H${end.x}`

                    return (
                      <>
                        <path
                          class={edge.flow ? "vz-line vz-dash" : "vz-line-muted"}
                          d={d}
                          stroke-dasharray={edge.flow ? "4 4" : undefined}
                          marker-end={edge.flow ? "url(#vz-flow-arrow)" : undefined}
                        />
                        <Show when={edge.label}>
                          <text
                            x={back ? mid : mid}
                            y={back ? H - 36 : (a.y + b.y) / 2 - 14}
                            text-anchor="middle"
                            style={{ "font-size": "11px" }}
                          >
                            {short(edge.label!, 22)}
                          </text>
                        </Show>
                      </>
                    )
                  })()}
                </Show>
              )
            }}
          </For>

          <For each={nodes()}>
            {(node) => {
              const at = () => point(node)

              return (
                <>
                  <SymbolMark symbol={node.symbol} x={at().x} y={at().y} active={node.active} />
                  <text x={at().x} y={at().y + 28} text-anchor="middle" style={{ fill: node.active ? "var(--v-fg)" : undefined, "font-size": "11.5px" }}>
                    {short(node.label, 18)}
                  </text>
                  <Show when={node.detail}>
                    <text class="vz-svg-key" x={at().x} y={at().y + 41} text-anchor="middle" style={{ "font-size": "11px" }}>
                      {short(node.detail!, 20)}
                    </text>
                  </Show>
                </>
              )
            }}
          </For>
        </svg>
      }
      readouts={
        <>
          <Readout label="Units" value={String(nodes().length)} />
          <Readout label="Streams" value={String(edges().length)} />
          <For each={objects(data().readouts).slice(0, 2)}>
            {(item) => <Readout label={str(item.label, "Value")} value={str(item.value, "—")} tone="accent" />}
          </For>
        </>
      }
    />
  )
}

function SymbolMark(props: { symbol: Symbol; x: number; y: number; active: boolean }) {
  const stroke = () => (props.active ? "var(--v-accent)" : "var(--v-fg-2)")
  const fill = () => (props.active ? "var(--v-accent-2)" : "none")

  return (
    <g stroke={stroke()} stroke-width="1.3" fill={fill()} stroke-linejoin="round" stroke-linecap="round">
      <Show when={props.symbol === "source" || props.symbol === "sink"}>
        <circle cx={props.x} cy={props.y} r={12} />
        <path d={`M${props.x - 6},${props.y} H${props.x + 6} M${props.x + 2},${props.y - 4} L${props.x + 6},${props.y} L${props.x + 2},${props.y + 4}`} />
      </Show>
      <Show when={props.symbol === "pump"}>
        <circle cx={props.x} cy={props.y} r={12} />
        <path d={`M${props.x - 4},${props.y - 6} L${props.x + 7},${props.y} L${props.x - 4},${props.y + 6} Z`} />
      </Show>
      <Show when={props.symbol === "valve"}>
        <path d={`M${props.x - 11},${props.y - 7} L${props.x},${props.y} L${props.x - 11},${props.y + 7} Z M${props.x + 11},${props.y - 7} L${props.x},${props.y} L${props.x + 11},${props.y + 7} Z`} />
      </Show>
      <Show when={props.symbol === "filter"}>
        <path d={`M${props.x - 11},${props.y - 9} H${props.x + 11} L${props.x + 3},${props.y} L${props.x + 11},${props.y + 9} H${props.x - 11} L${props.x - 3},${props.y} Z`} />
        <path d={`M${props.x - 6},${props.y - 4} H${props.x + 6} M${props.x - 6},${props.y + 4} H${props.x + 6}`} />
      </Show>
      <Show when={props.symbol === "tank"}>
        <rect x={props.x - 12} y={props.y - 13} width={24} height={26} rx={9} />
        <line x1={props.x - 12} x2={props.x + 12} y1={props.y + 4} y2={props.y + 4} />
      </Show>
      <Show when={props.symbol === "heat"}>
        <circle cx={props.x} cy={props.y} r={12} />
        <path d={`M${props.x - 6},${props.y + 6} L${props.x - 2},${props.y - 6} L${props.x + 2},${props.y + 6} L${props.x + 6},${props.y - 6}`} />
      </Show>
      <Show when={props.symbol === "machine"}>
        <circle cx={props.x} cy={props.y} r={8} />
        <circle cx={props.x} cy={props.y} r={3} />
        <path
          d={Array.from({ length: 8 }, (_, index) => {
            const angle = (index * Math.PI) / 4
            const inner = 8
            const outer = 12
            const x1 = props.x + inner * Math.cos(angle)
            const y1 = props.y + inner * Math.sin(angle)
            const x2 = props.x + outer * Math.cos(angle)
            const y2 = props.y + outer * Math.sin(angle)

            return `M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}`
          }).join(" ")}
        />
      </Show>
      <Show when={props.symbol === "sensor"}>
        <circle cx={props.x} cy={props.y} r={10} />
        <path d={`M${props.x},${props.y + 10} V${props.y + 16}`} />
        <path d={`M${props.x - 4},${props.y - 3} H${props.x + 4} M${props.x},${props.y - 3} V${props.y + 4}`} />
      </Show>
    </g>
  )
}
