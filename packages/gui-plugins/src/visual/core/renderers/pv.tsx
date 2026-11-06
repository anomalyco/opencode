/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- the spec parser and the read function above clamp every numeric field; these assertions only pick the branch the data already selected. */
import { createMemo, createSignal, For, Show } from "solid-js"
import { clamp, num, object, objects, optionalNum, pair, str } from "../json"
import { fmt } from "../format"
import { includeZero, linear, linePath, ticks, tickLabel } from "../scale"
import { IconButton, PlayIcon, Readout, ResetIcon } from "../controls"
import { createTicker, reducedMotion } from "../ticker"
import { VisualFrame } from "../frame"
import type { VisualSpec } from "../spec"

const W = 680

const H = 320

const CHART = { left: 58, right: 470, top: 24, bottom: 268 }

const PISTON = { x: 610, top: 54, bottom: 246, width: 52 }

type ProcessType = "isothermal" | "adiabatic" | "isochoric" | "isobaric" | "polytropic"

interface Step {
  readonly type: ProcessType
  readonly label: string
  readonly p1: number
  readonly v1: number
  readonly p2: number
  readonly v2: number
  readonly n: number
  readonly work: number
}

function processExponent(type: ProcessType, declared: number | undefined): number {
  if (type === "isothermal") return 1

  if (type === "adiabatic") return clamp(declared ?? 1.4, 1.01, 1.8)

  if (type === "isochoric") return Number.POSITIVE_INFINITY

  if (type === "isobaric") return 0

  return clamp(declared ?? 1.3, -10, 10)
}

function readSteps(spec: VisualSpec): Step[] {
  const data = object(spec.data) ?? {}
  const gasN = clamp(num(object(data.gas)?.gamma, 1.4), 1.01, 1.8)
  const steps: Step[] = []

  for (const item of objects(data.steps).slice(0, 8)) {
    const type = str(item.type, "polytropic") as ProcessType
    const from = pair(item.from)
    const to = pair(item.to)
    const p1 = clamp(from?.[0] ?? num(item.p1, 100), 0.01, 100000)
    const v1 = clamp(from?.[1] ?? num(item.v1, 1), 1e-5, 10000)
    const n = processExponent(type, optionalNum(item.n) ?? (type === "adiabatic" ? gasN : undefined))

    if (type === "isochoric") {
      const p2 = clamp(to?.[0] ?? num(item.p2, p1 * 2), 0.01, 100000)
      steps.push({ type, label: str(item.label, "Constant volume"), p1, v1, p2, v2: v1, n, work: 0 })
      continue
    }

    const v2 = clamp(to?.[1] ?? num(item.v2, v1 * num(item.ratio, 0.5)), 1e-5, 10000)

    if (type === "isobaric") {
      steps.push({ type, label: str(item.label, "Constant pressure"), p1, v1, p2: p1, v2, n: 0, work: p1 * (v2 - v1) })
      continue
    }

    const p2 = clamp(to?.[0] ?? p1 * (v1 / v2) ** n, 0.01, 100000)
    const work = Math.abs(n - 1) < 1e-6 ? p1 * v1 * Math.log(v2 / v1) : (p2 * v2 - p1 * v1) / (1 - n)
    steps.push({ type, label: str(item.label, labelFor(type)), p1, v1, p2, v2, n, work })
  }

  return steps
}

function labelFor(type: ProcessType): string {
  if (type === "isothermal") return "Isothermal"

  if (type === "adiabatic") return "Adiabatic"

  if (type === "isochoric") return "Constant volume"

  if (type === "isobaric") return "Constant pressure"

  return "Polytropic"
}

export function PvVisual(props: { spec: VisualSpec }) {
  const steps = createMemo(() => readSteps(props.spec))
  const [playing, setPlaying] = createSignal(!reducedMotion())
  const [cursor, setCursor] = createSignal(0)
  const [element, setElement] = createSignal<HTMLDivElement>()

  const samplesFor = (step: Step): Array<{ p: number; v: number }> => {
    const points: Array<{ p: number; v: number }> = []

    if (step.type === "isochoric") {
      for (let index = 0; index <= 24; index += 1) points.push({ p: step.p1 + ((step.p2 - step.p1) * index) / 24, v: step.v1 })
    } else if (Math.abs(step.n) < 1e-6) {
      for (let index = 0; index <= 24; index += 1) points.push({ p: step.p1, v: step.v1 + ((step.v2 - step.v1) * index) / 24 })
    } else {
      for (let index = 0; index <= 40; index += 1) {
        const v = step.v1 * (step.v2 / step.v1) ** (index / 40)
        points.push({ p: step.p1 * (step.v1 / v) ** step.n, v })
      }
    }

    return points
  }

  const stepSamples = createMemo(() => steps().map(samplesFor))
  const samples = createMemo(() => stepSamples().flat())

  const xDomain = createMemo(() => {
    const values = samples().map((point) => point.v)
    const min = Math.min(...values, 0.01)
    const max = Math.max(...values, 1)
    const pad = (max - min) * 0.1 || 0.1

    return [Math.max(0, min - pad), max + pad] as [number, number]
  })

  const yDomain = createMemo(() => {
    const values = samples().map((point) => point.p)

    return includeZero([0, Math.max(...values, 1) * 1.1] as [number, number])
  })

  const x = () => linear(xDomain(), [CHART.left, CHART.right])
  const y = () => linear(yDomain(), [CHART.bottom, CHART.top])

  const step = (delta: number) => {
    const count = samples().length

    if (count === 0) return
    setCursor((value) => (value + (delta / 1000) * 18) % count)
  }

  const ticker = createTicker(playing, step, element)

  const current = createMemo(() => samples()[Math.floor(cursor()) % Math.max(1, samples().length)])

  const cycleClosed = createMemo(() => {
    const list = samples()

    if (list.length < 3) return false

    const first = list[0]
    const last = list[list.length - 1]
    const span = Math.max(1e-9, Math.abs(first.p), Math.abs(first.v))

    return Math.abs(first.p - last.p) / span < 0.01 && Math.abs(first.v - last.v) / span < 0.01
  })

  const cyclePath = createMemo(() => {
    const points = samples().map((point) => [x()(point.v), y()(point.p)] as [number, number])

    return points.length > 2 ? `${linePath(points)} Z` : ""
  })

  const netWork = createMemo(() => steps().reduce((sum, item) => sum + item.work, 0))
  const expanded = createMemo(() => steps().reduce((sum, item) => sum + Math.max(0, item.work), 0))

  return (
    <div ref={setElement}>
      <VisualFrame
        spec={props.spec}
       
        tools={
          <>
            <IconButton label={playing() ? "Pause" : "Play"} pressed={playing()} onClick={() => { setPlaying((value) => !value); ticker.sync() }}>
              <PlayIcon playing={playing()} />
            </IconButton>
            <IconButton
              label="Reset"
              onClick={() => {
                setCursor(0)
                setPlaying(true)
                ticker.sync()
              }}
            >
              <ResetIcon />
            </IconButton>
          </>
        }
        stage={
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.spec.title}>
            <For each={ticks(yDomain(), 5)}>
              {(tick) => (
                <>
                  <line class="vz-guide" x1={CHART.left} x2={CHART.right} y1={y()(tick)} y2={y()(tick)} />
                  <text x={CHART.left - 8} y={y()(tick) + 3} text-anchor="end">
                    {tickLabel(tick, (ticks(yDomain(), 5)[1] ?? 1) - (ticks(yDomain(), 5)[0] ?? 0) || 1)}
                  </text>
                </>
              )}
            </For>
            <For each={ticks(xDomain(), 5)}>
              {(tick) => (
                <text x={x()(tick)} y={CHART.bottom + 15} text-anchor="middle">
                  {tickLabel(tick, (ticks(xDomain(), 5)[1] ?? 1) - (ticks(xDomain(), 5)[0] ?? 0) || 1)}
                </text>
              )}
            </For>
            <line class="vz-axis" x1={CHART.left} x2={CHART.right} y1={CHART.bottom} y2={CHART.bottom} />
            <line class="vz-axis" x1={CHART.left} x2={CHART.left} y1={CHART.top} y2={CHART.bottom} />
            <text class="vz-svg-key" x={CHART.right} y={CHART.bottom + 32} text-anchor="end">
              specific volume v (m³/kg)
            </text>
            <text class="vz-svg-key" x={CHART.left - 8} y={CHART.top - 6} text-anchor="end">
              p (kPa)
            </text>

            <Show when={cycleClosed()}>
              <path class="vz-fill-accent" d={cyclePath()} />
            </Show>

            <For each={steps()}>
              {(item, index) => {
                const points = (stepSamples()[index()] ?? []).map((point) => [x()(point.v), y()(point.p)] as [number, number])

                if (points.length < 2) return null
                const at = points[Math.floor(points.length * (index() % 2 === 0 ? 0.34 : 0.66))]

                return (
                  <>
                    <path class={item.work > 0 ? "vz-line-accent" : "vz-line"} d={linePath(points)} />
                    <text
                      class="vz-svg-key"
                      x={at[0] + (item.type === "isochoric" ? 8 : 0)}
                      y={at[1] - 12}
                      text-anchor={item.type === "isochoric" ? "start" : "middle"}
                    >
                      {item.label}
                    </text>
                  </>
                )
              }}
            </For>

            <Show when={current()}>
              <circle cx={x()(current()!.v)} cy={y()(current()!.p)} r={4} fill="var(--v-accent)" />
              <line class="vz-guide" x1={x()(current()!.v)} y1={y()(current()!.p)} x2={x()(current()!.v)} y2={CHART.bottom} />
            </Show>

            <Piston x={PISTON.x} top={PISTON.top} bottom={PISTON.bottom} width={PISTON.width} fill={(current()?.v ?? 1) / xDomain()[1]} />
            <text class="vz-svg-key" x={PISTON.x + PISTON.width / 2} y={PISTON.bottom + 20} text-anchor="middle">
              v {fmt(current()?.v ?? 0, 3)} m³/kg
            </text>
          </svg>
        }
        controls={
          <>
            <SliderCursor value={cursor()} max={Math.max(1, samples().length - 1)} onChange={setCursor} onPause={() => { setPlaying(false); ticker.sync() }} />
          </>
        }
        readouts={
          <>
            <Readout label="Net work" value={`${fmt(netWork(), 1)} kJ/kg`} tone={netWork() >= 0 ? "accent" : "critical"} />
            <Readout label="Expansion" value={`${fmt(expanded(), 1)} kJ/kg`} />
            <For each={steps().filter((item) => item.work < 0).slice(0, 2)}>
              {(item) => <Readout label="Compression" value={`${fmt(item.work, 1)} kJ/kg`} />}
            </For>
          </>
        }
        caption={props.spec.caption ?? "The area under each path is the work the gas exchanges. Compression work is negative when work enters the gas."}
      />
    </div>
  )
}

function SliderCursor(props: { value: number; max: number; onChange: (value: number) => void; onPause: () => void }) {
  return (
    <label class="vz-control">
      <span>Cycle</span>
      <input
        class="vz-range"
        type="range"
        min={0}
        max={props.max}
        step={1}
        value={props.value}
        onInput={(event) => {
          props.onPause()
          props.onChange(Number(event.currentTarget.value))
        }}
      />
      <output>{fmt((props.value / Math.max(1, props.max)) * 100, 0)}%</output>
    </label>
  )
}

function Piston(props: { x: number; top: number; bottom: number; width: number; fill: number }) {
  const height = () => props.bottom - props.top
  const pistonY = () => props.top + 18 + clamp(props.fill, 0, 1) * (height() - 34)

  return (
    <>
      <rect
        x={props.x}
        y={props.top}
        width={props.width}
        height={height()}
        fill="none"
        stroke="var(--v-line-2)"
        stroke-width="1.4"
      />
      <rect
        x={props.x + 1.5}
        y={props.top + 1.5}
        width={props.width - 3}
        height={Math.max(0, pistonY() - props.top - 3)}
        fill="var(--v-accent-2)"
      />
      <line x1={props.x} x2={props.x + props.width} y1={pistonY()} y2={pistonY()} stroke="var(--v-fg)" stroke-width="3" />
      <line x1={props.x + props.width / 2} x2={props.x + props.width / 2} y1={pistonY()} y2={pistonY() + 18} stroke="var(--v-fg-2)" stroke-width="2" />
      <line x1={props.x + props.width / 2 - 7} x2={props.x + props.width / 2 + 7} y1={pistonY() + 18} y2={pistonY() + 18} stroke="var(--v-fg-2)" stroke-width="2" />
      <For each={[0.25, 0.5, 0.75]}>
        {(fraction) => (
          <line
            x1={props.x + 3}
            x2={props.x + 7}
            y1={props.top + height() * fraction}
            y2={props.top + height() * fraction}
            stroke="var(--v-fg-3)"
          />
        )}
      </For>
    </>
  )
}
