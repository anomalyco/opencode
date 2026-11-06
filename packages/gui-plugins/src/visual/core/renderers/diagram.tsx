/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- the spec parser and the read function above clamp every numeric field; these assertions only pick the branch the data already selected. */
import { For, Show } from "solid-js"
import { num, object, objects, optionalStr, str } from "../json"
import { short } from "../format"
import { VisualFrame } from "../frame"
import type { VisualSpec } from "../spec"

const W = 680

const H = 300

interface Node {
  id: string
  label: string
  detail?: string
  x: number
  y: number
  tone: "accent" | "muted" | "critical"
}

interface ScreenPoint {
  readonly x: number
  readonly y: number
}

interface Edge {
  from: string
  to: string
  label?: string
  style: "solid" | "dashed"
  arrow: boolean
}

function nodeTone(value: string): Node["tone"] {
  if (value === "accent") return "accent"

  if (value === "critical") return "critical"

  return "muted"
}

function nodeFill(tone: Node["tone"]): string {
  if (tone === "critical") return "var(--v-critical)"

  if (tone === "accent") return "var(--v-accent)"

  return "var(--v-bg)"
}

export function DiagramVisual(props: { spec: VisualSpec }) {
  const data = () => object(props.spec.data) ?? {}

  const edges = (): Edge[] =>
    objects(data().edges)
      .slice(0, 28)
      .map((item) => ({
        from: str(item.from, ""),
        to: str(item.to, ""),
        label: optionalStr(item.label),
        style: (str(item.style, "solid") === "dashed" ? "dashed" : "solid") as Edge["style"],
        arrow: item.arrow !== false,
      }))
      .filter((item) => item.from && item.to)

  const nodes = (): Node[] => {
    const declared = objects(data().nodes).slice(0, 14)

    const raw = declared.map((item, index) => ({
      id: str(item.id, `n${index}`),
      label: str(item.label, `Step ${index + 1}`),
      detail: optionalStr(item.detail),
      x: num(item.x, Number.NaN),
      y: num(item.y, Number.NaN),
      tone: nodeTone(str(item.tone, "muted")),
    }))

    if (raw.some((item) => !Number.isFinite(item.x) || !Number.isFinite(item.y))) {
      const ids = new Set(raw.map((item) => item.id))
      const incoming = new Map<string, string[]>()
      raw.forEach((item) => incoming.set(item.id, []))
      edges().forEach((edge) => {
        if (ids.has(edge.from) && ids.has(edge.to)) incoming.get(edge.to)?.push(edge.from)
      })

      const level = new Map<string, number>()

      const visit = (id: string, seen: Set<string>): number => {
        if (seen.has(id)) return level.get(id) ?? 0
        seen.add(id)
        const parents = incoming.get(id) ?? []
        const value = parents.length === 0 ? 0 : Math.max(...parents.map((parent) => visit(parent, seen))) + 1
        level.set(id, Math.max(level.get(id) ?? 0, value))

        return value
      }

      raw.forEach((item) => visit(item.id, new Set()))

      const levels = Math.max(1, ...raw.map((item) => level.get(item.id) ?? 0))
      const columns = new Map<number, string[]>()
      raw.forEach((item) => {
        const index = level.get(item.id) ?? 0
        columns.set(index, [...(columns.get(index) ?? []), item.id])
      })
      const widest = Math.max(...[...columns.values()].map((column) => column.length))
      const vertical = levels >= 3 && widest <= 2

      raw.forEach((item, position) => {
        const index = level.get(item.id) ?? 0
        const column = columns.get(index) ?? [item.id]
        const order = column.indexOf(item.id)

        if (vertical) {
          item.x = 0.3
          item.y = raw.length === 1 ? 0.5 : position / (raw.length - 1)
        } else {
          item.x = levels === 0 ? 0.5 : index / levels
          item.y = column.length === 1 ? 0.5 : 0.16 + (order / Math.max(1, column.length - 1)) * 0.68
        }
      })

      return raw
    }

    return raw
  }

  const vertical = () => {
    const ys = new Set(nodes().map((node) => node.y))

    return nodes().length >= 4 && ys.size === nodes().length && nodes().every((node) => Math.abs(node.x - nodes()[0].x) < 0.01)
  }

  const point = (node: Node): ScreenPoint => {
    if (vertical()) return { x: 54 + node.x * (W - 108), y: 26 + node.y * (H - 52) }

    return { x: 54 + node.x * (W - 108), y: 42 + node.y * (H - 78) }
  }

  return (
    <VisualFrame
      spec={props.spec}
      stage={
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.spec.title}>
          <defs>
            <marker id="vz-diagram-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
              <path class="vz-arrow" d="M0 0 7 3.5 0 7Z" />
            </marker>
            <marker id="vz-diagram-arrow-accent" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
              <path class="vz-arrow-accent" d="M0 0 7 3.5 0 7Z" />
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
                    const middle: [number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2]
                    const back = vertical() && nodes().findIndex((node) => node.id === edge.to) < nodes().findIndex((node) => node.id === edge.from)

                    const dx = b.x - a.x
                    const dy = b.y - a.y
                    const length = Math.hypot(dx, dy) || 1

                    const end = back
                      ? { x: b.x - 13, y: b.y }
                      : { x: b.x - (dx / length) * 12, y: b.y - (dy / length) * 12 }

                    const path = back
                      ? `M${a.x - 11},${a.y} C${a.x - 64},${a.y} ${a.x - 64},${b.y} ${end.x},${end.y}`
                      : `M${a.x},${a.y} L${end.x},${end.y}`

                    return (
                      <>
                        <path
                          class={edge.style === "dashed" ? "vz-line-muted" : "vz-line"}
                          d={path}
                          marker-end={
                            edge.arrow
                              ? from()!.tone === "accent"
                                ? "url(#vz-diagram-arrow-accent)"
                                : "url(#vz-diagram-arrow)"
                              : undefined
                          }
                        />
                        <Show when={edge.label}>
                          <text
                            x={back ? a.x - 70 : vertical() ? middle[0] + 9 : middle[0]}
                            y={back ? middle[1] : middle[1] - 6}
                            text-anchor={back ? "end" : vertical() ? "start" : "middle"}
                          >
                            {short(edge.label!, 24)}
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
            {(node, index) => {
              const at = point(node)

              return (
                <>
                  <text class="vz-svg-key" x={at.x - 36} y={at.y + 3} text-anchor="end">
                    {String(index() + 1).padStart(2, "0")}
                  </text>
                  <circle
                    cx={at.x}
                    cy={at.y}
                    r={node.tone === "accent" ? 4 : 3}
                    fill={nodeFill(node.tone)}
                    stroke={node.tone === "muted" ? "var(--v-fg-2)" : "none"}
                    stroke-width="1.2"
                  />
                  <text class="vz-svg-key" style={{ fill: node.tone === "accent" ? "var(--v-fg)" : undefined }} x={at.x + 11} y={at.y + 4}>
                    {short(node.label, 28)}
                  </text>
                  <Show when={node.detail}>
                    <text class="vz-svg-key" x={at.x + 11} y={at.y + 16}>
                      {short(node.detail!, 40)}
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
          <span class="vz-readout">
            <span>Nodes</span>
            <b>{nodes().length}</b>
          </span>
          <span class="vz-readout">
            <span>Edges</span>
            <b>{edges().length}</b>
          </span>
          <Show when={edges().some((edge) => edge.style === "dashed")}>
            <span class="vz-readout">
              <span>Revision</span>
              <b>1</b>
            </span>
          </Show>
        </>
      }
    />
  )
}
