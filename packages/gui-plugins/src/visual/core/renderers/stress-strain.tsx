/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- the spec parser and the read function above clamp every numeric field; these assertions only pick the branch the data already selected. */
import { createMemo, createSignal, For, Show } from "solid-js"
import { clamp, num, object, objects, pairs, str } from "../json"
import { fmt } from "../format"
import { includeZero, linear, linePath, ticks, tickLabel } from "../scale"
import { Readout, Slider } from "../controls"
import { VisualFrame } from "../frame"
import type { VisualSpec } from "../spec"

const W = 680

const H = 300

const M = { top: 18, right: 96, bottom: 40, left: 54 }

interface Material {
  readonly name: string
  readonly points: Array<[number, number]>
  readonly yieldPoint?: [number, number]
  readonly ultimatePoint?: [number, number]
}

function buildMaterial(item: ReturnType<typeof object>, index: number): Material | undefined {
  if (!item) return undefined
  const name = str(item.name, `Material ${index + 1}`)
  const explicit = pairs(item.points, 200)

  if (explicit.length >= 2) {
    const peak = explicit.reduce((best, point) => (point[1] > best[1] ? point : best), explicit[0])

    return { name, points: explicit, ultimatePoint: peak }
  }

  const youngs = clamp(num(item.E, index === 0 ? 200 : 69), 0.1, 1000)
  const yieldStress = clamp(num(item.yield, index === 0 ? 250 : 110), 1, 5000)
  const ultimate = clamp(num(item.ultimate, yieldStress * 1.55), yieldStress, 8000)
  const brittle = yieldStress >= ultimate * 0.98
  const yieldStrain = (yieldStress / (youngs * 1000)) * 100

  const ultimateStrain = brittle
    ? Math.max(yieldStrain * 1.4, 0.4)
    : clamp(num(item.ultimateStrain, Math.max(yieldStrain * 12, 5)), yieldStrain * 1.2, 60)

  const fractureStrain = brittle
    ? ultimateStrain
    : clamp(num(item.fractureStrain, ultimateStrain * 1.35), ultimateStrain * 1.01, 80)

  const points: Array<[number, number]> = brittle
    ? [
        [0, 0],
        [ultimateStrain, ultimate],
        [fractureStrain, 0],
      ]
    : [
        [0, 0],
        [yieldStrain, yieldStress],
        [ultimateStrain, ultimate],
        [fractureStrain, ultimate * 0.82],
        [fractureStrain * 1.02, 0],
      ]

  return {
    name,
    points,
    yieldPoint: brittle ? undefined : [yieldStrain, yieldStress],
    ultimatePoint: [ultimateStrain, ultimate],
  }
}

export function StressStrainVisual(props: { spec: VisualSpec }) {
  const data = () => object(props.spec.data) ?? {}

  const materials = createMemo(() =>
    objects(data().materials)
      .slice(0, 4)
      .map(buildMaterial)
      .filter((item): item is Material => item !== undefined),
  )

  const [strain, setStrain] = createSignal(10)

  const xDomain = createMemo(() => {
    const values = materials().flatMap((material) => material.points.map((point) => point[0]))
    const max = Math.max(...values, 1)

    return [0, max * 1.04] as [number, number]
  })

  const yDomain = createMemo(() => {
    const values = materials().flatMap((material) => material.points.map((point) => point[1]))

    return includeZero([0, Math.max(...values, 1) * 1.06] as [number, number])
  })

  const x = () => linear(xDomain(), [M.left, W - M.right])
  const y = () => linear(yDomain(), [H - M.bottom, M.top])

  const xTicks = () => ticks(xDomain(), 6)
  const yTicks = () => ticks(yDomain(), 5)
  const xStep = () => xTicks()[1] - xTicks()[0] || 1
  const yStep = () => yTicks()[1] - yTicks()[0] || 1

  const stressAt = (material: Material, at: number): number | undefined => {
    const points = material.points

    if (at < points[0][0] || at > points[points.length - 1][0]) return undefined

    for (let index = 0; index < points.length - 1; index += 1) {
      const [x0, y0] = points[index]
      const [x1, y1] = points[index + 1]

      if (at >= x0 && at <= x1) return x1 === x0 ? y0 : y0 + ((at - x0) / (x1 - x0)) * (y1 - y0)
    }

    return points[points.length - 1][1]
  }

  return (
    <VisualFrame
      spec={props.spec}
     
      stage={
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.spec.title}>
          <For each={yTicks()}>
            {(tick) => (
              <>
                <line class="vz-guide" x1={M.left} x2={W - M.right} y1={y()(tick)} y2={y()(tick)} />
                <text x={M.left - 8} y={y()(tick) + 3} text-anchor="end">
                  {tickLabel(tick, yStep())}
                </text>
              </>
            )}
          </For>
          <For each={xTicks()}>
            {(tick) => (
              <text x={x()(tick)} y={H - M.bottom + 15} text-anchor="middle">
                {tickLabel(tick, xStep())}
              </text>
            )}
          </For>
          <line class="vz-axis" x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} />
          <line class="vz-axis" x1={M.left} x2={M.left} y1={M.top} y2={H - M.bottom} />
          <text class="vz-svg-key" x={W - M.right} y={H - 6} text-anchor="end">
            engineering strain (%)
          </text>
          <text class="vz-svg-key" x={8} y={M.top - 4}>
            stress (MPa)
          </text>

          <For each={materials()}>
            {(material, index) => (
              <g>
                <path
                  class={index() === 0 ? "vz-line-accent" : "vz-line-muted"}
                  d={linePath(material.points.map((point) => [x()(point[0]), y()(point[1])]))}
                />
                <Show when={material.yieldPoint}>
                  <line
                    class="vz-guide"
                    x1={x()(material.yieldPoint![0])}
                    x2={x()(material.yieldPoint![0])}
                    y1={y()(0)}
                    y2={y()(material.yieldPoint![1])}
                  />
                  <circle cx={x()(material.yieldPoint![0])} cy={y()(material.yieldPoint![1])} r={2.2} fill="var(--v-fg-2)" />
                </Show>
                <Show when={material.ultimatePoint}>
                  <circle
                    cx={x()(material.ultimatePoint![0])}
                    cy={y()(material.ultimatePoint![1])}
                    r={2.2}
                    fill={index() === 0 ? "var(--v-accent)" : "var(--v-fg-2)"}
                  />
                  <text
                    class={index() === 0 ? "vz-svg-value" : "vz-svg-key"}
                    x={x()(material.ultimatePoint![0]) + 7}
                    y={y()(material.ultimatePoint![1]) + 3}
                  >
                    {material.name.slice(0, 22)}
                  </text>
                </Show>
              </g>
            )}
          </For>

          <line class="vz-guide" x1={x()(strain())} x2={x()(strain())} y1={M.top} y2={H - M.bottom} />
          <For each={materials()}>
            {(material, index) => {
              const stress = stressAt(material, strain())

              return (
                <Show when={stress !== undefined}>
                  <circle cx={x()(strain())} cy={y()(stress!)} r={3.4} fill={index() === 0 ? "var(--v-accent)" : "var(--v-fg-2)"} />
                </Show>
              )
            }}
          </For>
        </svg>
      }
      onReset={() => setStrain(10)}
      controls={
        <Slider
          label="Strain"
          value={strain()}
          min={0}
          max={xDomain()[1]}
          step={xDomain()[1] / 200}
          format={(value) => `${fmt(value, 1)}%`}
          onInput={setStrain}
        />
      }
      readouts={
        <>
          <For each={materials()}>
            {(material, index) => (
              <Show when={index() < 3}>
                <Readout
                  label={`${material.name.slice(0, 18)} at ${fmt(strain(), 1)}%`}
                  value={stressAt(material, strain()) === undefined ? "—" : `${fmt(stressAt(material, strain())!, 1)} MPa`}
                  tone={index() === 0 ? "accent" : undefined}
                />
              </Show>
            )}
          </For>
        </>
      }
      caption={props.spec.caption ?? "The linear slope is Young's modulus. The yield point ends elastic behavior, and the ultimate point is the highest stress the material carries before necking."}
    />
  )
}
