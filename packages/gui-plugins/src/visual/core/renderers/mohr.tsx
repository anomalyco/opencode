/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- the spec parser and the read function above clamp every numeric field; these assertions only pick the branch the data already selected. */
import { createMemo, createSignal, For, Show } from "solid-js"
import { clamp, num, object } from "../json"
import { fmt } from "../format"
import { ticks, tickLabel } from "../scale"
import { Readout, Slider } from "../controls"
import { VisualFrame } from "../frame"
import type { VisualSpec } from "../spec"

const W = 680

const H = 340

const PLOT = { left: 74, right: W - 40, top: 28, bottom: H - 58 }

export function MohrVisual(props: { spec: VisualSpec }) {
  const data = () => object(props.spec.data) ?? {}
  const sx = () => clamp(num(data().sigmaX, 80), -5000, 5000)
  const sy = () => clamp(num(data().sigmaY, 20), -5000, 5000)
  const txy = () => clamp(num(data().tauXY, 40), -5000, 5000)
  const unit = () => props.spec.unit ?? "MPa"
  const [rotate, setRotate] = createSignal(0)

  const circle = createMemo(() => {
    const center = (sx() + sy()) / 2
    const radius = Math.hypot((sx() - sy()) / 2, txy())

    return {
      center,
      radius,
      major: center + radius,
      minor: center - radius,
      angle: (Math.atan2(2 * txy(), sx() - sy()) * 180) / Math.PI / 2,
    }
  })

  const at = (degrees: number) => {
    const phi = (circle().angle * Math.PI) / 180
    const theta = (degrees * Math.PI) / 180
    const angle = 2 * theta - 2 * phi

    return { normal: circle().center + circle().radius * Math.cos(angle), shear: -circle().radius * Math.sin(angle) }
  }

  const state = createMemo(() => at(rotate()))

  const geometry = createMemo(() => {
    const radius = Math.max(circle().radius * 1.18, 1)
    const center = circle().center

    const scale = Math.min(
      (PLOT.right - PLOT.left) / (2 * radius),
      (PLOT.bottom - PLOT.top) / (2 * radius),
    )

    const midX = (PLOT.left + PLOT.right) / 2
    const midY = (PLOT.top + PLOT.bottom) / 2

    return {
      radius,
      normal: [center - radius, center + radius] as [number, number],
      shear: [-radius, radius] as [number, number],
      x: (value: number) => midX + (value - center) * scale,
      y: (value: number) => midY - value * scale,
      cx: midX,
      cy: midY,
      scale,
    }
  })

  const normalTicks = () => ticks(geometry().normal, 5)

  const shearTicks = () => {
    const radius = circle().radius

    return [-radius, -radius / 2, 0, radius / 2, radius].map((value) => Math.round(value * 10) / 10)
  }

  const normalStep = () => normalTicks()[1] - normalTicks()[0] || 1
  const shearStep = () => shearTicks()[1] - shearTicks()[0] || 1

  const cloud = createMemo(() =>
    Array.from({ length: 181 }, (_, index) => {
      const point = at(index)

      return [geometry().x(point.normal), geometry().y(point.shear)] as [number, number]
    }),
  )

  const current = createMemo(() => [geometry().x(state().normal), geometry().y(state().shear)] as [number, number])
  const original = createMemo(() => [geometry().x(sx()), geometry().y(txy())] as [number, number])
  const complement = createMemo(() => [geometry().x(sy()), geometry().y(-txy())] as [number, number])

  return (
    <VisualFrame
      spec={props.spec}
      stage={
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.spec.title}>
          <For each={normalTicks()}>
            {(tick) => (
              <>
                <line class="vz-guide" x1={geometry().x(tick)} x2={geometry().x(tick)} y1={PLOT.top} y2={PLOT.bottom} />
                <text x={geometry().x(tick)} y={PLOT.bottom + 16} text-anchor="middle">
                  {tickLabel(tick, normalStep())}
                </text>
              </>
            )}
          </For>
          <For each={shearTicks()}>
            {(tick) => (
              <>
                <line class="vz-guide" x1={PLOT.left} x2={PLOT.right} y1={geometry().y(tick)} y2={geometry().y(tick)} />
                <text x={PLOT.left - 9} y={geometry().y(tick) + 3} text-anchor="end">
                  {tickLabel(tick, shearStep())}
                </text>
              </>
            )}
          </For>

          <Show when={geometry().normal[0] <= 0 && geometry().normal[1] >= 0}>
            <line class="vz-axis" x1={geometry().x(0)} x2={geometry().x(0)} y1={PLOT.top} y2={PLOT.bottom} />
          </Show>
          <line class="vz-axis" x1={PLOT.left} x2={PLOT.right} y1={geometry().y(0)} y2={geometry().y(0)} />
          <text class="vz-svg-key" x={PLOT.right} y={H - 8} text-anchor="end">
            normal stress σ ({unit()})
          </text>
          <text class="vz-svg-key" x={8} y={PLOT.top - 8}>
            shear τ ({unit()})
          </text>

          <path class="vz-line-accent" d={cloud().map(([px, py], index) => `${index === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ")} />

          <line class="vz-line-muted" x1={original()[0]} y1={original()[1]} x2={complement()[0]} y2={complement()[1]} />

          <circle cx={geometry().x(circle().major)} cy={geometry().y(0)} r={3.2} fill="var(--v-accent)" />
          <circle cx={geometry().x(circle().minor)} cy={geometry().y(0)} r={3.2} fill="var(--v-fg-2)" />
          <text class="vz-svg-value" x={geometry().x(circle().major) + 12} y={geometry().y(0) - 14} text-anchor="start">
            σ₁ {fmt(circle().major, 1)}
          </text>
          <text x={geometry().x(circle().minor) - 8} y={geometry().y(0) + 18} text-anchor="end">
            σ₂ {fmt(circle().minor, 1)}
          </text>
          <text x={geometry().x(circle().center)} y={geometry().y(circle().radius) - 9} text-anchor="middle">
            τmax {fmt(circle().radius, 1)}
          </text>

          <circle cx={original()[0]} cy={original()[1]} r={3.4} fill="var(--v-bg)" stroke="var(--v-fg-2)" stroke-width="1.2" />
          <text class="vz-svg-key" x={original()[0] + 6} y={original()[1] - 6}>
            X (σx, τxy)
          </text>
          <circle cx={complement()[0]} cy={complement()[1]} r={3.4} fill="var(--v-bg)" stroke="var(--v-fg-2)" stroke-width="1.2" />
          <text class="vz-svg-key" x={complement()[0] + 6} y={complement()[1] + 13}>
            Y (σy, −τxy)
          </text>

          <line class="vz-guide" x1={geometry().cx} y1={geometry().cy} x2={current()[0]} y2={current()[1]} />
          <circle cx={current()[0]} cy={current()[1]} r={4.2} fill="var(--v-accent)" />
          <text class="vz-svg-value" x={current()[0] + 8} y={current()[1] + 16}>
            σ {fmt(state().normal, 1)}, τ {state().shear < 0 ? "−" : "+"}{fmt(Math.abs(state().shear), 1)}
          </text>
        </svg>
      }
      onReset={() => setRotate(0)}
      controls={
        <Slider label="Rotate" value={rotate()} min={0} max={180} step={1} format={(value) => `${fmt(value, 0)}°`} onInput={setRotate} />
      }
      readouts={
        <>
          <Readout label="σ₁" value={fmt(circle().major, 1)} tone="accent" />
          <Readout label="σ₂" value={fmt(circle().minor, 1)} />
          <Readout label="τmax" value={fmt(circle().radius, 1)} />
          <Readout label="θp" value={`${fmt(circle().angle, 1)}°`} />
          <Readout label="Current" value={`σ ${fmt(state().normal, 1)}, τ ${state().shear < 0 ? "−" : "+"}${fmt(Math.abs(state().shear), 1)}`} />
        </>
      }
      caption={props.spec.caption ?? "Each point on the circle is the stress on one plane. The principal stresses are where the circle crosses the normal-stress axis and shear is zero."}
    />
  )
}
