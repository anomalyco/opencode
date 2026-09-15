import React from "react"
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import { days, launchIndex, glmWeekTokensT, segments } from "./data"

// stats.opencode.ai design tokens (light theme)
const c = {
  bg: "#ffffff",
  ink: "#161616",
  muted: "#5c5c5c",
  faint: "#808080",
  line: "#e6e6e6",
  dot: "#ededed",
  accent: "#3b5cf6",
  accentHi: "#5b78ff",
}

const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
const W = 1080

const DOT_MASK =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 6 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0H2V2H0V0Z' fill='black'/%3E%3C/svg%3E\")"

const field = segments.filter((s) => !s.hero)
const glmColor = segments.find((s) => s.hero)!.color

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// the correct opencode "DATA" wordmark (from stats.opencode.ai header)
function DataWordmark({ height = 30, color = c.ink }: { height?: number; color?: string }) {
  return (
    <svg width={(height * 66) / 20} height={height} viewBox="0 0 66 20" fill="none" style={{ color }}>
      <path opacity="0.2" d="M12 16H4V8H12V16Z" fill="currentColor" />
      <path d="M12 4H4V16H12V4ZM16 20H0V0H16V20Z" fill="currentColor" />
      <path
        d="M63.3543 16L62.5119 12.8711H58.6437L57.8013 16H55.7383L59.2454 4H61.9618L65.4689 16H63.3543ZM61.0678 7.851L60.6896 5.94269H60.4489L60.0707 7.851L59.1595 11.1347H61.9962L61.0678 7.851Z"
        fill="currentColor"
      />
      <path d="M52.5951 5.87392V16H50.4461V5.87392H47.4375V4H55.6209V5.87392H52.5951Z" fill="currentColor" />
      <path
        d="M45.2059 16L44.3635 12.8711H40.4953L39.6529 16H37.5898L41.097 4H43.8133L47.3205 16H45.2059ZM42.9194 7.851L42.5411 5.94269H42.3004L41.9222 7.851L41.011 11.1347H43.8477L42.9194 7.851Z"
        fill="currentColor"
      />
      <path
        d="M28 4H32.0917C32.8138 4 33.4556 4.11461 34.0172 4.34384C34.5903 4.5616 35.0716 4.9169 35.4613 5.40974C35.8625 5.89112 36.1662 6.51003 36.3725 7.26648C36.5788 8.02292 36.6819 8.9341 36.6819 10C36.6819 11.0659 36.5788 11.9771 36.3725 12.7335C36.1662 13.49 35.8625 14.1146 35.4613 14.6075C35.0716 15.0888 34.5903 15.4441 34.0172 15.6734C33.4556 15.8911 32.8138 16 32.0917 16H28V4ZM32.0917 14.1261C32.8252 14.1261 33.3926 13.9026 33.7937 13.4556C34.1948 12.9971 34.3954 12.3152 34.3954 11.4097V8.59026C34.3954 7.68481 34.1948 7.0086 33.7937 6.5616C33.3926 6.10315 32.8252 5.87392 32.0917 5.87392H30.149V14.1261H32.0917Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function GLM52Rise() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // ---------- virtual camera ----------
  // open zoomed-in on the field, pan right while the blue fills, then pull back to reveal.
  const K = [0, 32, 150, 206, 240]
  const ease = Easing.inOut(Easing.cubic)
  const opt = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const, easing: ease }
  const s = interpolate(frame, K, [1.82, 1.72, 1.72, 1.0, 1.0], opt)
  let fx = interpolate(frame, K, [420, 438, 760, 540, 540], opt)
  let fy = interpolate(frame, K, [664, 664, 664, 540, 540], opt)
  // keep the framing inside the 1080 canvas so edges never reveal black
  fx = clamp(fx, 540 / s, W - 540 / s)
  fy = clamp(fy, 540 / s, W - 540 / s)
  const camera = `translate(${540 - fx * s}px, ${540 - fy * s}px) scale(${s})`

  // ---------- blue sweep (synced to the pan) ----------
  const p = interpolate(frame, [32, 150], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease })
  const revealAmount = p * (days.length - launchIndex) + 0.35
  const fillOf = (i: number) => clamp(revealAmount - (i - launchIndex), 0, 1)

  // token number climbs as the camera pulls back and the headline re-enters frame
  const tokensT =
    glmWeekTokensT *
    interpolate(frame, [150, 202], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    })

  // chart geometry
  const chartH = 440
  const chartW = 936
  const gap = 14
  const EXAGGERATE = 2.876 // broken y-axis: GLM-5.2 magnified ~2.9x for emphasis

  return (
    <AbsoluteFill style={{ background: c.bg, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          width: W,
          height: W,
          background: c.bg,
          transformOrigin: "0 0",
          transform: camera,
        }}
      >
        <div
          style={{
            width: W,
            height: W,
            boxSizing: "border-box",
            padding: 72,
            color: c.ink,
            fontFamily: MONO,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <DataWordmark height={30} />
            <div style={{ fontSize: 20, fontWeight: 500, color: c.faint, letterSpacing: 1 }}>JUN 12–25, 2026</div>
          </div>

          {/* headline (static) */}
          <div style={{ marginTop: 52 }}>
            <div style={{ fontSize: 92, fontWeight: 600, lineHeight: 0.98, letterSpacing: -2 }}>
              GLM-5.2 <span style={{ color: c.accent }}>broke out</span>
            </div>
            <div style={{ marginTop: 22, fontSize: 30, fontWeight: 500, color: c.muted }}>
              From 0 to <span style={{ color: c.ink }}>{tokensT.toFixed(2)}T tokens</span> in a week.
            </div>
          </div>

          {/* stacked chart */}
          <div style={{ flex: 1, display: "flex", alignItems: "flex-end", marginTop: 40 }}>
            <div
              style={{
                position: "relative",
                width: chartW,
                height: chartH,
                margin: "0 auto",
                borderBottom: `2px solid ${c.ink}`,
                boxSizing: "border-box",
              }}
            >
              {/* faint dotted backdrop */}
              <div
                style={{
                  position: "absolute",
                  left: -8,
                  right: -8,
                  top: -8,
                  bottom: 0,
                  background: c.dot,
                  WebkitMaskImage: DOT_MASK,
                  maskImage: DOT_MASK,
                  WebkitMaskSize: "12px 12px",
                  maskSize: "12px 12px",
                  WebkitMaskRepeat: "repeat",
                  maskRepeat: "repeat",
                }}
              />

              {/* columns */}
              <div style={{ position: "absolute", inset: 0, display: "flex", gap, alignItems: "flex-end" }}>
                {days.map((d, i) => {
                  const glmShare = d.glm / d.total
                  const blueH = Math.round(glmShare * EXAGGERATE * chartH)
                  const filled = Math.round(blueH * fillOf(i))
                  const slotGap = filled > 2 ? 5 : 0
                  const fieldH = chartH - filled - slotGap
                  const fieldTotal = d.dsf + d.dsp + d.mm + d.others
                  return (
                    <div key={i} style={{ position: "relative", flex: 1, height: chartH }}>
                      {/* gray field of other models (already in place) */}
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          height: fieldH,
                          display: "flex",
                          flexDirection: "column-reverse",
                        }}
                      >
                        {field.map((seg) => (
                          <div
                            key={seg.key}
                            style={{
                              height: Math.round(((d[seg.key as keyof typeof d] as number) / fieldTotal) * fieldH),
                              background: seg.color,
                              borderTop: `2px solid ${c.bg}`,
                            }}
                          />
                        ))}
                      </div>
                      {/* GLM-5.2, animates in */}
                      {filled > 2 && (
                        <div
                          style={{
                            position: "absolute",
                            left: 0,
                            right: 0,
                            bottom: 0,
                            height: filled,
                            background: glmColor,
                            borderTop: `2px solid ${c.accentHi}`,
                          }}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* day axis */}
          <div style={{ display: "flex", gap, width: chartW, margin: "14px auto 0" }}>
            {days.map((d, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  textAlign: "center",
                  fontSize: 15,
                  fontWeight: 500,
                  color: i === days.length - 1 ? c.ink : c.faint,
                }}
              >
                {i === 0 || i === launchIndex || i === days.length - 1 ? d.date : ""}
              </div>
            ))}
          </div>

          {/* footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 28,
              paddingTop: 22,
              borderTop: `1px solid ${c.line}`,
              fontSize: 20,
              fontWeight: 500,
            }}
          >
            <div style={{ display: "inline-flex", alignItems: "center", gap: 9, color: c.muted }}>
              <span style={{ width: 13, height: 13, background: c.accent, display: "inline-block" }} />
              GLM-5.2
            </div>
            <div style={{ color: c.ink }}>opencode.ai/data</div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
