/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- the spec parser and the read function above clamp every numeric field; these assertions only pick the branch the data already selected. */
import { createMemo, For, Show } from "solid-js"
import { clamp } from "../json"
import { fmt } from "../format"
import { extent, linear } from "../scale"
import { Readout } from "../controls"
import { VisualFrame } from "../frame"
import type { VisualSpec } from "../spec"

const W = 680

const H = 430

const LEFT = 62

const RIGHT = 620

import { readBeam, solve } from "./beam-math"

export function BeamVisual(props: { spec: VisualSpec }) {
  const model = createMemo(() => readBeam(props.spec))
  const result = createMemo(() => solve(model()))
  const x = () => linear([0, model().length], [LEFT, RIGHT])

  const shearDomain = () => {
    const [min, max] = extent(result().shear, [-1, 1])
    const span = Math.max(Math.abs(min), Math.abs(max), 1e-6)

    return [-span, span] as [number, number]
  }

  const momentDomain = () => {
    if (model().type === "simply-supported") return [0, Math.max(result().peakMoment * 1.08, 1e-6)] as [number, number]

    const [min, max] = extent(result().moment, [-1, 1])
    const span = Math.max(Math.abs(min), Math.abs(max), 1e-6)

    return [-span, span] as [number, number]
  }

  const momentTicks = () =>
    model().type === "simply-supported" ? [0, result().peakMoment] : [-Math.abs(result().peakMoment), 0, Math.abs(result().peakMoment)]

  const peakIndex = () => {
    const values = result().moment.map((value) => Math.abs(value))
    const peak = Math.max(...values)

    return Math.max(0, values.indexOf(peak))
  }

  const sfd = { top: 176, bottom: 262 }
  const bmd = { top: 300, bottom: 404 }
  const sy = () => linear(shearDomain(), [sfd.bottom, sfd.top])
  const my = () => linear(momentDomain(), [bmd.bottom, bmd.top])
  const beamY = 96

  const area = (values: number[], zero: number, scale: (value: number) => number) => {
    const points = result().x.map((at, index) => [x()(at), scale(values[index])] as [number, number])

    if (points.length === 0) return ""

    return `${points.map(([px, py], index) => `${index === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ")} L${x()(model().length).toFixed(1)},${zero} L${LEFT},${zero} Z`
  }

  const deflScale = () => {
    const values = result().deflection

    if (!values) return 0
    const max = Math.max(...values.map(Math.abs), 1e-9)

    return 24 / max
  }

  return (
    <VisualFrame
      spec={props.spec}
     
      stage={
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.spec.title}>
          <text class="vz-svg-key" x={LEFT} y={22}>
            Free body
          </text>
          <line class="vz-line" x1={LEFT} x2={RIGHT} y1={beamY} y2={beamY} stroke-width="3" />

          <For each={model().loads}>
            {(load) => {
              if (load.kind === "point") {
                const px = x()(load.x)
                const length = clamp(Math.abs(load.value) * 3 + 14, 16, 42)

                return (
                  <>
                    <line x1={px} x2={px} y1={beamY - length} y2={beamY - 6} stroke="var(--v-accent)" stroke-width="1.4" />
                    <path d={`M${px - 4},${beamY - 12} L${px},${beamY - 4} L${px + 4},${beamY - 12} Z`} fill="var(--v-accent)" />
                    <text class="vz-svg-value" x={px + 5} y={beamY - length - 2}>
                      {fmt(load.value, 1)} kN
                    </text>
                  </>
                )
              }

              const from = x()(load.from)
              const to = x()(load.to)
              const count = Math.max(2, Math.min(12, Math.round((to - from) / 26) + 1))

              return (
                <>
                  <line x1={from} x2={to} y1={beamY - 40} y2={beamY - 40} stroke="var(--v-accent)" stroke-width="1.2" />
                  <For each={Array.from({ length: count }, (_, index) => index)}>
                    {(index) => {
                      const px = from + ((to - from) * index) / (count - 1)

                      return (
                        <>
                          <line x1={px} x2={px} y1={beamY - 40} y2={beamY - 6} stroke="var(--v-accent)" stroke-width="1" />
                          <path d={`M${px - 3.5},${beamY - 12} L${px},${beamY - 4} L${px + 3.5},${beamY - 12} Z`} fill="var(--v-accent)" />
                        </>
                      )
                    }}
                  </For>
                  <text class="vz-svg-value" x={(from + to) / 2} y={beamY - 47} text-anchor="middle">
                    {fmt(load.value, 1)} kN/m
                  </text>
                </>
              )
            }}
          </For>

          <Show when={model().type === "simply-supported"}>
            <Support x={x()(0)} label={`R₁ ${fmt(result().leftReaction, 2)} kN`} align="start" />
            <Support x={x()(model().length)} label={`R₂ ${fmt(result().rightReaction, 2)} kN`} align="end" />
          </Show>
          <Show when={model().type === "cantilever"}>
            <Fixed x={x()(0)} label={`M ${fmt(result().fixedMoment, 1)} kN·m`} />
          </Show>

          <Show when={result().deflection}>
            <text class="vz-svg-key" x={(LEFT + RIGHT) / 2} y={beamY + 54} text-anchor="middle">
              deflection (exaggerated)
            </text>
            <path
              class="vz-line-muted"
              d={result()
                .deflection!.map((value, index) => `${index === 0 ? "M" : "L"}${x()(result().x[index]).toFixed(1)},${(beamY + 12 - value * deflScale()).toFixed(1)}`)
                .join(" ")}
            />
          </Show>

          <text class="vz-svg-key" x={8} y={sfd.top - 18}>
            Shear V (kN)
          </text>
          <line class="vz-axis" x1={LEFT} x2={RIGHT} y1={sy()(0)} y2={sy()(0)} />
          <For each={[-Math.abs(result().peakShear), 0, Math.abs(result().peakShear)]}>
            {(tick) => (
              <text x={LEFT - 8} y={sy()(tick) + 3} text-anchor="end">
                {fmt(tick, 1)}
              </text>
            )}
          </For>
          <path d={area(result().shear, sy()(0), sy())} fill="var(--v-line-2)" opacity="0.55" />
          <path class="vz-line" d={result().shear.map((value, index) => `${index === 0 ? "M" : "L"}${x()(result().x[index]).toFixed(1)},${sy()(value).toFixed(1)}`).join(" ")} />

          <text class="vz-svg-key" x={8} y={bmd.top - 18}>
            Bending moment M (kN·m)
          </text>
          <line class="vz-axis" x1={LEFT} x2={RIGHT} y1={my()(0)} y2={my()(0)} />
          <For each={momentTicks()}>
            {(tick) => (
              <text x={LEFT - 8} y={my()(tick) + 3} text-anchor="end">
                {fmt(tick, 1)}
              </text>
            )}
          </For>
          <circle cx={x()(result().x[peakIndex()])} cy={my()(result().peakMoment)} r={3} fill="var(--v-accent)" />
          <text class="vz-svg-value" x={x()(result().x[peakIndex()]) + 7} y={my()(result().peakMoment) - 7}>
            {fmt(result().peakMoment, 1)}
          </text>
          <path d={area(result().moment, my()(0), my())} fill="var(--v-accent-2)" />
          <path class="vz-line-accent" d={result().moment.map((value, index) => `${index === 0 ? "M" : "L"}${x()(result().x[index]).toFixed(1)},${my()(value).toFixed(1)}`).join(" ")} />

          <For each={[0, model().length / 2, model().length]}>
            {(at) => (
              <text x={x()(at)} y={H - 8} text-anchor={at === 0 ? "start" : at === model().length ? "end" : "middle"}>
                {fmt(at, 2)} {model().unit}
              </text>
            )}
          </For>
        </svg>
      }
      readouts={
        <>
          <Readout label="Max moment" value={`${fmt(result().peakMoment, 1)} kN·m`} tone="accent" />
          <Readout label="Peak shear" value={`${fmt(Math.abs(result().peakShear), 2)} kN`} />
          <Show when={result().stress !== undefined}>
            <Readout label="Peak stress" value={`${fmt(result().stress ?? 0, 1)} MPa`} tone={(result().stress ?? 0) > model().yield ? "critical" : undefined} />
            <Readout label="Utilization" value={`${fmt(((result().stress ?? 0) / model().yield) * 100, 1)}%`} />
          </Show>
          <Show when={result().deflection}>
            <Readout label="Max deflection" value={`${fmt(result().maxDeflection, 2)} mm`} />
          </Show>
          <Show when={result().props}>
            <Readout label="Second moment I" value={`${fmt((result().props?.inertia ?? 0) * 1e5, 2)} ×10⁻⁵ m⁴`} />
          </Show>
        </>
      }
      caption={props.spec.caption ?? "Shear and moment follow from static equilibrium. The deflection curve is linear elastic, using Euler–Bernoulli theory."}
    />
  )
}

function Support(props: { x: number; label: string; align: "start" | "end" }) {
  return (
    <>
      <path d={`M${props.x - 9},${96 + 2} L${props.x + 9},${96 + 2} L${props.x},${96 + 18} Z`} fill="none" stroke="var(--v-fg-2)" stroke-width="1.2" />
      <For each={[-9, -4, 1, 6]}>
        {(offset) => <line x1={props.x + offset} y1={110} x2={props.x + offset - 3} y2={115} stroke="var(--v-fg-3)" />}
      </For>
      <line x1={props.x + 13} x2={props.x + 13} y1={112} y2={98} stroke="var(--v-fg-2)" stroke-width="1" />
      <path d={`M${props.x + 9},${102} L${props.x + 13},${96} L${props.x + 17},${102} Z`} fill="var(--v-fg-2)" />
      <text x={props.x} y={130} text-anchor={props.align === "start" ? "start" : "end"}>
        {props.label}
      </text>
    </>
  )
}

function Fixed(props: { x: number; label: string }) {
  return (
    <>
      <line x1={props.x} x2={props.x} y1={78} y2={114} stroke="var(--v-fg-2)" stroke-width="2" />
      <For each={[80, 86, 92, 98, 104, 110]}>
        {(y) => <line x1={props.x} y1={y} x2={props.x - 7} y2={y + 6} stroke="var(--v-fg-3)" />}
      </For>
      <text x={props.x + 8} y={132}>
        {props.label}
      </text>
    </>
  )
}
