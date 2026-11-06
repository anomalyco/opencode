/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- the spec parser and the read function above clamp every numeric field; these assertions only pick the branch the data already selected. */
import { createMemo, For, Show } from "solid-js"
import { object, objects, pair, pairs, str } from "../json"
import { fmt, short } from "../format"
import { includeZero, linear, linePath, ticks, tickLabel } from "../scale"
import { VisualFrame } from "../frame"
import type { VisualSpec } from "../spec"

const W = 680

const H = 300

const M = { top: 18, right: 104, bottom: 40, left: 64 }

interface Series {
  label: string
  points: Array<[number, number]>
  style: "line" | "points" | "area" | "bar"
  tone: "accent" | "muted"
}

export function PlotVisual(props: { spec: VisualSpec }) {
  const data = () => object(props.spec.data) ?? {}

  const series = createMemo<Series[]>(() => {
    const parsed = objects(data().series)
      .slice(0, 8)
      .map((item, index) => ({
        label: str(item.label, `Series ${index + 1}`),
        points: pairs(item.points),
        style: normalizeStyle(str(item.style, "line")),
        tone: (str(item.tone, index === 0 ? "accent" : "muted") === "accent" ? "accent" : "muted") as Series["tone"],
      }))
      .filter((item) => item.points.length > 0)

    const budget = Math.max(2, Math.floor(800 / Math.max(1, parsed.length)))

    return parsed.map((item) => ({ ...item, points: preserve(item.points, budget) }))
  })

  const xMeta = () => object(data().x) ?? {}
  const yMeta = () => object(data().y) ?? {}
  const all = () => series().flatMap((item) => item.points)

  const xLog = () => str(xMeta().scale, "linear") === "log"
  const yLog = () => str(yMeta().scale, "linear") === "log"

  const xDomain = () => {
    const declared = pairs(xMeta().domain)[0]

    if (declared) return declared
    const values = all().map((point) => point[0])
    const positive = values.filter((value) => value > 0)

    if (xLog()) return [Math.min(...positive) / 1.15, Math.max(...positive) * 1.15] as [number, number]

    return [Math.min(...values, 0), Math.max(...values, 1)] as [number, number]
  }

  const yDomain = () => {
    const declared = pairs(yMeta().domain)[0]

    if (declared) return declared
    const values = all().map((point) => point[1])
    const positive = values.filter((value) => value > 0)

    if (yLog()) return [Math.min(...positive) / 1.15, Math.max(...positive) * 1.15] as [number, number]

    return includeZero([Math.min(...values, 0), Math.max(...values, 1)] as [number, number])
  }

  const xScale = () => {
    const domain = xDomain()
    const inner = linear(xLog() ? [Math.log10(domain[0]), Math.log10(domain[1])] : domain, [M.left, W - M.right])

    return (value: number) => (xLog() ? inner(Math.log10(Math.max(value, 1e-12))) : inner(value))
  }

  const yScale = () => {
    const domain = yDomain()
    const inner = linear(yLog() ? [Math.log10(domain[0]), Math.log10(domain[1])] : domain, [H - M.bottom, M.top])

    return (value: number) => (yLog() ? inner(Math.log10(Math.max(value, 1e-12))) : inner(value))
  }

  const xTicks = () => {
    const base = xLog() ? logTicks(xDomain()) : ticks(xDomain(), 6)
    const max = Math.max(...all().map((point) => point[0]))
    const last = base[base.length - 1]

    return last !== undefined && max > last * 1.02 ? [...base, max] : base
  }

  const yTicks = () => {
    const base = yLog() ? logTicks(yDomain()) : ticks(yDomain(), 5)
    const max = Math.max(...all().map((point) => point[1]))
    const last = base[base.length - 1]

    return last !== undefined && max > last * 1.02 ? [...base, max] : base
  }

  const xStep = () => (xTicks().length > 1 ? xTicks()[1] - xTicks()[0] : 1)
  const yStep = () => (yTicks().length > 1 ? yTicks()[1] - yTicks()[0] : 1)

  const bars = () => series().filter((item) => item.style === "bar")
  const lines = () => series().filter((item) => item.style !== "bar")

  const barWidth = () => {
    const groups = bars()[0]?.points.length ?? 1
    const slot = (W - M.right - M.left) / Math.max(1, groups)

    return Math.max(2, Math.min(26, (slot * 0.64) / Math.max(1, bars().length)))
  }

  const xLabel = () => [str(xMeta().label, ""), str(xMeta().unit, "")].filter(Boolean).join(", ")
  const yLabel = () => [str(yMeta().label, ""), str(yMeta().unit, "")].filter(Boolean).join(", ")

  return (
    <VisualFrame
      spec={props.spec}
      stage={
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.spec.title}>
          <For each={yTicks()}>
            {(tick) => (
              <>
                <line class="vz-guide" x1={M.left} x2={W - M.right} y1={yScale()(tick)} y2={yScale()(tick)} />
                <text x={M.left - 8} y={yScale()(tick) + 3} text-anchor="end">
                  {compact(tick, yStep())}
                </text>
              </>
            )}
          </For>
          <For each={xTicks()}>
            {(tick) => (
              <text x={xScale()(tick)} y={H - M.bottom + 15} text-anchor="middle">
                {compact(tick, xStep())}
              </text>
            )}
          </For>
          <line class="vz-axis" x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} />
          <line class="vz-axis" x1={M.left} x2={M.left} y1={M.top} y2={H - M.bottom} />

          <Show when={!yLog() && yDomain()[0] <= 0 && yDomain()[1] >= 0}>
            <line class="vz-axis" x1={M.left} x2={W - M.right} y1={yScale()(0)} y2={yScale()(0)} stroke-dasharray="1 3" />
          </Show>

          <text class="vz-svg-key" x={M.left} y={H - 6}>
            {short(xLabel(), 46)}
          </text>
          <text class="vz-svg-key" x={8} y={M.top - 5}>
            {short(yLabel(), 34)}
          </text>

          <For each={bars()}>
            {(item, seriesIndex) =>
              item.points.map((point) => {
                const count = Math.max(1, bars().length)
                const center = xScale()(point[0]) - ((count - 1) * barWidth()) / 2 + seriesIndex() * barWidth()
                const zero = yLog() ? yScale()(yDomain()[0]) : yScale()(0)

                return (
                  <rect
                    x={center - barWidth() / 2}
                    y={Math.min(zero, yScale()(point[1]))}
                    width={barWidth()}
                    height={Math.max(1, Math.abs(yScale()(point[1]) - zero))}
                    fill={item.tone === "accent" ? "var(--v-accent)" : "var(--v-line-2)"}
                    opacity={item.tone === "accent" ? 0.9 : 0.8}
                  >
                    <title>{`${item.label}: ${fmt(point[1])}`}</title>
                  </rect>
                )
              })
            }
          </For>

          <For each={lines()}>
            {(item) => (
              <>
                <Show when={item.style === "area"}>
                  <path
                    class="vz-fill-accent"
                    d={`${linePath(item.points.map((point) => [xScale()(point[0]), yScale()(point[1])]))} L${xScale()(item.points[item.points.length - 1][0])},${H - M.bottom} L${xScale()(item.points[0][0])},${H - M.bottom} Z`}
                  />
                </Show>
                <path
                  class={item.tone === "accent" ? "vz-line-accent" : "vz-line-muted"}
                  d={linePath(item.points.map((point) => [xScale()(point[0]), yScale()(point[1])]))}
                />
                <Show when={item.style === "points"}>
                  <For each={item.points}>
                    {(point) => (
                      <circle
                        cx={xScale()(point[0])}
                        cy={yScale()(point[1])}
                        r={2.4}
                        fill={item.tone === "accent" ? "var(--v-accent)" : "var(--v-fg-2)"}
                      />
                    )}
                  </For>
                </Show>
              </>
            )}
          </For>

          <For each={series().slice(0, 4)}>
            {(item) => {
              const point = item.points[item.points.length - 1]
              const px = xScale()(point[0])
              const py = yScale()(point[1])
              const anchor = px > W - 150 ? "end" : "start"

              return (
                <g>
                  <circle cx={px} cy={py} r={2.4} fill={item.tone === "accent" ? "var(--v-accent)" : "var(--v-fg-2)"} />
                  <text
                    class={item.tone === "accent" ? "vz-svg-key" : undefined}
                    x={anchor === "end" ? px - 8 : px + 8}
                    y={py - 14}
                    text-anchor={anchor}
                  >
                    {short(item.label, 18)}
                  </text>
                </g>
              )
            }}
          </For>

          <For each={objects(data().annotations).slice(0, 6)}>
            {(item) => {
              const at = pair(item.at)

              if (!at) return null

              return (
                <>
                  <line class="vz-guide" x1={xScale()(at[0])} x2={xScale()(at[0])} y1={yScale()(at[1])} y2={yScale()(at[1]) - 14} />
                  <text x={xScale()(at[0])} y={yScale()(at[1]) - 18} text-anchor="middle">
                    {short(str(item.label, ""), 24)}
                  </text>
                </>
              )
            }}
          </For>
        </svg>
      }
      readouts={
        <Show when={props.spec.unit}>
          <span class="vz-readout">
            <span>Units</span>
            <b>{props.spec.unit}</b>
          </span>
        </Show>
      }
    />
  )
}

function preserve(points: Array<[number, number]>, budget: number): Array<[number, number]> {
  if (points.length <= budget) return points

  const buckets = Math.max(1, Math.floor(budget / 4))
  const size = points.length / buckets
  const kept: Array<[number, number]> = []

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.floor(bucket * size)
    const end = Math.min(points.length, Math.max(start + 1, Math.floor((bucket + 1) * size)))
    let min = start
    let max = start

    for (let index = start; index < end; index += 1) {
      if (points[index][1] < points[min][1]) min = index

      if (points[index][1] > points[max][1]) max = index
    }

    const indices = [...new Set([start, min, max, end - 1])].sort((a, b) => a - b)

    for (const index of indices) kept.push(points[index])
  }

  return kept
}

function normalizeStyle(value: string): Series["style"] {
  if (value === "points" || value === "area" || value === "bar") return value

  return "line"
}

function logTicks(domain: readonly [number, number]): number[] {
  const start = Math.floor(Math.log10(Math.max(domain[0], 1e-12)))
  const end = Math.ceil(Math.log10(Math.max(domain[1], 1e-12)))
  const decades = Array.from({ length: Math.max(0, end - start) + 1 }, (_, index) => 10 ** (start + index))
  const values: number[] = []

  for (const decade of decades) {
    for (const multiplier of [1, 2, 5]) {
      const value = decade * multiplier

      if (value >= domain[0] * 0.999 && value <= domain[1] * 1.001) values.push(value)
    }
  }

  if (values.length <= 7) return values

  return decades.filter((value) => value >= domain[0] * 0.999 && value <= domain[1] * 1.001)
}

function compact(value: number, step: number): string {
  const magnitude = Math.abs(value)

  if (magnitude >= 1e9) return `${trim(value / 1e9)}G`

  if (magnitude >= 1e6) return `${trim(value / 1e6)}M`

  if (magnitude >= 1e3) return `${trim(value / 1e3)}k`

  return tickLabel(value, step)
}

function trim(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)
}
