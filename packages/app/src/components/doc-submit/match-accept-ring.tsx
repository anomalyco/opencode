import { createMemo, createUniqueId, For, Show } from "solid-js"

type Palette = "helmet" | "safety"

type Props = {
  remaining?: number
  total?: number
  full?: boolean
  size?: number
  stroke?: number
  palette?: Palette
  animate?: boolean
}

const colors = {
  helmet: {
    stripe: "#ffce2b",
    glow1: "rgba(255, 206, 43, 0.55)",
    glow2: "rgba(255, 206, 43, 0.32)",
    wave: "rgba(255, 245, 200, 0.55)",
    flash: "rgba(255, 250, 220, 0.95)",
    flashGlow: "rgba(255,245,200,0.9)",
  },
  safety: {
    stripe: "#ff6b1f",
    glow1: "rgba(255, 107, 31, 0.55)",
    glow2: "rgba(255, 107, 31, 0.32)",
    wave: "rgba(255, 220, 200, 0.55)",
    flash: "rgba(255, 230, 215, 0.92)",
    flashGlow: "rgba(255,220,200,0.9)",
  },
}

function pt(cx: number, cy: number, R: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return [cx + R * Math.cos(rad), cy + R * Math.sin(rad)] as const
}

export function MatchAcceptRing(props: Props) {
  const size = () => props.size ?? 480
  const stroke = () => props.stroke ?? 16
  const total = () => props.total ?? 15
  const full = () => props.full ?? false
  const remaining = () => props.remaining ?? 0
  const palette = () => props.palette ?? "helmet"
  const animate = () => props.animate ?? true
  const uid = createUniqueId()
  const tone = () => colors[palette()]

  const consumption = createMemo(() => {
    if (full()) return 0
    const t = total()
    if (t <= 0) return 1
    return Math.max(0, Math.min(1, (t - remaining()) / t))
  })

  const geo = createMemo(() => {
    const s = size()
    const sw = stroke()
    const cx = s / 2
    const cy = s / 2
    const r = s / 2 - sw - 8
    const innerR = r - sw / 2 - 2
    const sweepDeg = 320
    const startDeg = 200
    const consumedAngDeg = sweepDeg * consumption()
    const visibleAngDeg = sweepDeg - consumedAngDeg
    const stripeInnerR = r - sw / 2
    const stripeOuterR = r + sw / 2
    const diagShiftDeg = (sw / r) * (180 / Math.PI)
    const boundaryAngDeg = startDeg + consumedAngDeg
    const gaugeEndAngDeg = startDeg + sweepDeg
    return {
      cx,
      cy,
      r,
      innerR,
      sweepDeg,
      startDeg,
      visibleAngDeg,
      stripeInnerR,
      stripeOuterR,
      diagShiftDeg,
      boundaryAngDeg,
      gaugeEndAngDeg,
      consumedAngDeg,
    }
  })

  const gaugeClipPath = createMemo(() => {
    const g = geo()
    if (g.visibleAngDeg <= 0.001) return null
    const a0 = g.boundaryAngDeg
    const a1 = g.gaugeEndAngDeg
    const [ix0, iy0] = pt(g.cx, g.cy, g.stripeInnerR, a0)
    const [ix1, iy1] = pt(g.cx, g.cy, g.stripeInnerR, a1)
    const [ox1, oy1] = pt(g.cx, g.cy, g.stripeOuterR, a1 + g.diagShiftDeg)
    const [ox0, oy0] = pt(g.cx, g.cy, g.stripeOuterR, a0 + g.diagShiftDeg)
    const largeArc = g.visibleAngDeg > 180 ? 1 : 0
    return (
      `M ${ix0.toFixed(2)} ${iy0.toFixed(2)} ` +
      `A ${g.stripeInnerR} ${g.stripeInnerR} 0 ${largeArc} 1 ${ix1.toFixed(2)} ${iy1.toFixed(2)} ` +
      `L ${ox1.toFixed(2)} ${oy1.toFixed(2)} ` +
      `A ${g.stripeOuterR} ${g.stripeOuterR} 0 ${largeArc} 0 ${ox0.toFixed(2)} ${oy0.toFixed(2)} Z`
    )
  })

  const wavePath = createMemo(() => {
    const g = geo()
    const waveAngDeg = 9
    const a0 = g.startDeg
    const a1 = a0 + waveAngDeg
    const [ix0, iy0] = pt(g.cx, g.cy, g.stripeInnerR, a0)
    const [ix1, iy1] = pt(g.cx, g.cy, g.stripeInnerR, a1)
    const [ox1, oy1] = pt(g.cx, g.cy, g.stripeOuterR, a1 + g.diagShiftDeg)
    const [ox0, oy0] = pt(g.cx, g.cy, g.stripeOuterR, a0 + g.diagShiftDeg)
    return (
      `M ${ix0.toFixed(2)} ${iy0.toFixed(2)} ` +
      `A ${g.stripeInnerR} ${g.stripeInnerR} 0 0 1 ${ix1.toFixed(2)} ${iy1.toFixed(2)} ` +
      `L ${ox1.toFixed(2)} ${oy1.toFixed(2)} ` +
      `A ${g.stripeOuterR} ${g.stripeOuterR} 0 0 0 ${ox0.toFixed(2)} ${oy0.toFixed(2)} Z`
    )
  })

  const stripes = createMemo(() => {
    const g = geo()
    if (g.visibleAngDeg <= 0.001) return [] as { d: string; fill: string; key: string }[]
    const totalStripes = 64
    const stripeAngDeg = g.sweepDeg / totalStripes
    const stripeAt = (i: number, startAngOffset: number, lenAngDeg: number) => {
      const a0 = g.startDeg + i * stripeAngDeg + startAngOffset
      const a1 = g.startDeg + i * stripeAngDeg + startAngOffset + lenAngDeg
      const [ix0, iy0] = pt(g.cx, g.cy, g.stripeInnerR, a0)
      const [ix1, iy1] = pt(g.cx, g.cy, g.stripeInnerR, a1)
      const [ox1, oy1] = pt(g.cx, g.cy, g.stripeOuterR, a1 + g.diagShiftDeg)
      const [ox0, oy0] = pt(g.cx, g.cy, g.stripeOuterR, a0 + g.diagShiftDeg)
      return (
        `M ${ix0.toFixed(2)} ${iy0.toFixed(2)} ` +
        `A ${g.stripeInnerR} ${g.stripeInnerR} 0 0 1 ${ix1.toFixed(2)} ${iy1.toFixed(2)} ` +
        `L ${ox1.toFixed(2)} ${oy1.toFixed(2)} ` +
        `A ${g.stripeOuterR} ${g.stripeOuterR} 0 0 0 ${ox0.toFixed(2)} ${oy0.toFixed(2)} Z`
      )
    }
    const partialIdx = Math.floor(g.consumedAngDeg / stripeAngDeg)
    const boundaryWithin = g.consumedAngDeg - partialIdx * stripeAngDeg
    const out: { d: string; fill: string; key: string }[] = []
    if (boundaryWithin > 0.001 && partialIdx < totalStripes) {
      const remainLen = stripeAngDeg - boundaryWithin
      out.push({
        key: `p${partialIdx}`,
        d: stripeAt(partialIdx, boundaryWithin, remainLen),
        fill: partialIdx % 2 === 0 ? tone().stripe : "#17171c",
      })
    }
    const firstFullIdx = boundaryWithin > 0.001 ? partialIdx + 1 : partialIdx
    for (let i = firstFullIdx; i < totalStripes; i++) {
      out.push({
        key: String(i),
        d: stripeAt(i, 0, stripeAngDeg),
        fill: i % 2 === 0 ? tone().stripe : "#17171c",
      })
    }
    return out
  })

  const glow = () => `drop-shadow(0 0 14px ${tone().glow1}) drop-shadow(0 0 32px ${tone().glow2})`

  return (
    <svg class="ds-match-ring" width={size()} height={size()} viewBox={`0 0 ${size()} ${size()}`}>
      <defs>
        <Show when={gaugeClipPath()}>
          <clipPath id={`gauge-clip-${uid}`}>
            <path d={gaugeClipPath()!} />
          </clipPath>
        </Show>
      </defs>

      <circle cx={geo().cx} cy={geo().cy} r={geo().innerR} fill="var(--ds-disc)" />

      <Show when={geo().visibleAngDeg > 0.001}>
        <g class="ds-match-ring__gauge" style={{ filter: glow() }}>
          <Show when={palette() === "safety" && gaugeClipPath()}>
            <path d={gaugeClipPath()!} fill={tone().stripe} />
          </Show>
          <Show when={palette() !== "safety"}>
            <For each={stripes()}>{(item) => <path d={item.d} fill={item.fill} />}</For>
          </Show>
          <Show when={animate() && gaugeClipPath()}>
            <g clip-path={`url(#gauge-clip-${uid})`}>
              <g>
                <path d={wavePath()} fill={tone().wave} />
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from={`0 ${geo().cx} ${geo().cy}`}
                  to={`${geo().sweepDeg} ${geo().cx} ${geo().cy}`}
                  dur="2.6s"
                  repeatCount="indefinite"
                />
              </g>
            </g>
          </Show>
          <Show when={full() && gaugeClipPath()}>
            <g
              class="ds-gauge-flash-in"
              style={{
                filter:
                  palette() === "safety"
                    ? `drop-shadow(0 0 40px ${tone().flashGlow}) drop-shadow(0 0 90px ${tone().glow1})`
                    : `drop-shadow(0 0 40px ${tone().flashGlow}) drop-shadow(0 0 90px ${tone().glow1})`,
              }}
            >
              <path d={gaugeClipPath()!} fill={tone().flash} />
            </g>
          </Show>
        </g>
      </Show>
    </svg>
  )
}
