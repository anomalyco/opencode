import { createMemo, For, Show } from "solid-js"
import { num, object, objects, str } from "../json"
import { linear } from "../scale"
import { fmt, short } from "../format"
import { Readout } from "../controls"
import { VisualFrame } from "../frame"
import type { VisualSpec } from "../spec"

const W = 680

const H = 300

interface Item {
  readonly name: string
  readonly plus: number
  readonly minus: number
}

export function ToleranceVisual(props: { spec: VisualSpec }) {
  const data = () => object(props.spec.data) ?? {}

  const items = createMemo<Item[]>(() =>
    objects(data().stack)
      .slice(0, 12)
      .map((item, index) => ({
        name: str(item.name, `Dimension ${index + 1}`),
        plus: Math.abs(num(item.plus, 0)),
        minus: Math.abs(num(item.minus, num(item.plus, 0))),
      })),
  )

  const unit = () => props.spec.unit ?? str(data().unit, "mm")
  const nominal = () => num(data().nominal, 0)
  const limitPlus = () => Math.abs(num(object(data().limits)?.upper, num(data().upper, Number.NaN)))
  const limitMinus = () => Math.abs(num(object(data().limits)?.lower, num(data().lower, Number.NaN)))

  const worst = createMemo(() => {
    const plus = items().reduce((sum, item) => sum + item.plus, 0)
    const minus = items().reduce((sum, item) => sum + item.minus, 0)

    return { plus, minus }
  })

  const rss = createMemo(() => Math.sqrt(items().reduce((sum, item) => sum + ((item.plus + item.minus) / 2) ** 2, 0)))
  const biggest = createMemo(() => items().reduce((best, item) => (item.plus + item.minus > best ? item.plus + item.minus : best), 0))
  const sorted = createMemo(() => [...items()].sort((a, b) => b.plus + b.minus - (a.plus + a.minus)))
  const maxContrib = () => Math.max(biggest(), 1e-9)

  const verdict = () => {
    const upperOk = Number.isFinite(limitPlus()) ? worst().plus <= limitPlus() : true
    const lowerOk = Number.isFinite(limitMinus()) ? worst().minus <= limitMinus() : true

    return upperOk && lowerOk
  }

  return (
    <VisualFrame
      spec={props.spec}
     
      stage={
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.spec.title}>
          <text class="vz-svg-key" x={60} y={24}>
            Clearance against the allowed limits
          </text>

          {(() => {
            const margin = Math.max(worst().plus, worst().minus, Number.isFinite(limitPlus()) ? limitPlus() : 0, 1e-9) * 1.35
            const domain: [number, number] = [nominal() - margin, nominal() + margin]
            const scale = linear(domain, [70, W - 70])
            const allowedLow = Number.isFinite(limitMinus()) ? nominal() - limitMinus() : nominal() - worst().minus
            const allowedHigh = Number.isFinite(limitPlus()) ? nominal() + limitPlus() : nominal() + worst().plus
            const worstLow = nominal() - worst().minus
            const worstHigh = nominal() + worst().plus

            return (
              <>
                <rect x={scale(allowedLow)} y={56} width={Math.max(1, scale(allowedHigh) - scale(allowedLow))} height={26} fill="var(--v-line-2)" />
                <rect x={scale(worstLow)} y={66} width={Math.max(1, scale(worstHigh) - scale(worstLow))} height={7} fill={verdict() ? "var(--v-accent)" : "var(--v-critical)"} />
                <line x1={scale(nominal())} x2={scale(nominal())} y1={50} y2={90} stroke="var(--v-fg-2)" />
                <text x={scale(nominal())} y={44} text-anchor="middle" class="vz-svg-value">
                  nominal {fmt(nominal(), 3)}
                </text>
                <text x={scale(allowedLow)} y={100} text-anchor="start">
                  {fmt(allowedLow, 3)}
                </text>
                <text x={scale(allowedHigh)} y={100} text-anchor="end">
                  {fmt(allowedHigh, 3)}
                </text>
                <text x={70} y={122} class="vz-svg-key">
                  Allowed band +{fmt(Number.isFinite(limitPlus()) ? limitPlus() : margin, 3)} / −{fmt(Number.isFinite(limitMinus()) ? limitMinus() : margin, 3)} {unit()}
                </text>
                <text x={70} y={138} class="vz-svg-key">
                  Worst-case band +{fmt(worst().plus, 3)} / −{fmt(worst().minus, 3)} {unit()}
                </text>
              </>
            )
          })()}

          <text class="vz-svg-key" x={60} y={166}>
            Tolerance contribution, total band
          </text>

          <For each={sorted()}>
            {(item, index) => {
              const y = 176 + index() * 13
              const width = () => ((item.plus + item.minus) / maxContrib()) * (W - 360)

              return (
                <>
                  <text x={60} y={y + 8} text-anchor="start">
                    {short(item.name, 20)}
                  </text>
                  <rect x={188} y={y} width={Math.max(1, width())} height={8} fill={item.plus + item.minus === biggest() ? "var(--v-accent)" : "var(--v-line-2)"} />
                  <text x={196 + width()} y={y + 8} class="vz-svg-key">
                    +{fmt(item.plus, 3)} / −{fmt(item.minus, 3)}
                  </text>
                </>
              )
            }}
          </For>

        </svg>
      }
      readouts={
        <>
          <Readout label="Nominal" value={`${fmt(nominal(), 3)} ${unit()}`} />
          <Readout
            label="Worst case"
            value={`+${fmt(worst().plus, 3)} / −${fmt(worst().minus, 3)}`}
            tone={verdict() ? undefined : "critical"}
          />
          <Readout label="RSS" value={`±${fmt(rss(), 3)}`} />
          <Show when={Number.isFinite(limitPlus())}>
            <Readout label="Limits" value={`+${fmt(limitPlus(), 3)} / −${fmt(limitMinus(), 3)}`} tone={verdict() ? "accent" : "critical"} />
          </Show>
        </>
      }
      caption={props.spec.caption ?? "Worst-case stack-up adds every tolerance. RSS assumes independent, random errors and gives a statistical estimate."}
      note={props.spec.note ?? "Dimensional tolerances only; geometric tolerances and process bias are excluded."}
    />
  )
}
