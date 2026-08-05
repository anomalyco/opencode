import React from "react"
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"

const c = {
  bg: "#ffffff",
  ink: "#161616",
  muted: "#5c5c5c",
  faint: "#808080",
  line: "#e6e6e6",
  dot: "#e4e4e4",
  accent: "#3b5cf6",
  accentHi: "#5b78ff",
  accentDim: "#aebcf3",
}
const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

const DOT_MASK =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 6 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0H2V2H0V0Z' fill='black'/%3E%3C/svg%3E\")"

// verified: minimax-m3, OpenCode Go (tier=Go, dataset=zen), weekly total_tokens.
// W26 2.559T is +23.2% / +482.3B vs W25 2.077T.
const weeks = [
  { label: "May 25", t: 0.008 },
  { label: "Jun 1", t: 0.429 },
  { label: "Jun 8", t: 1.192 },
  { label: "Jun 15", t: 2.077 },
  { label: "Jun 22", t: 2.559, latest: true },
]
const AXIS_MAX = 3.0

function DataWordmark({ height = 30 }: { height?: number }) {
  return (
    <svg width={(height * 66) / 20} height={height} viewBox="0 0 66 20" fill="none" style={{ color: c.ink }}>
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

const CHART_H = 420 // multiple of 12 so the dotted tracks never clip

export function MiniMaxClimb() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const grow = (i: number) =>
    Math.min(
      1,
      Math.max(0, spring({ frame: frame - 22 - i * 9, fps, config: { damping: 18, stiffness: 110, mass: 0.6 } })),
    )

  return (
    <AbsoluteFill style={{ background: c.bg, color: c.ink, fontFamily: MONO, padding: 72, boxSizing: "border-box" }}>
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <DataWordmark height={30} />
          <div style={{ fontSize: 20, fontWeight: 500, color: c.faint, letterSpacing: 1 }}>JUN 22–28, 2026</div>
        </div>

        {/* headline (static) */}
        <div style={{ marginTop: 50 }}>
          <div style={{ fontSize: 23, fontWeight: 600, color: c.muted, letterSpacing: 2 }}>
            OPENCODE GO · WEEKLY TOKENS
          </div>
          <div
            style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 24, marginTop: 14 }}
          >
            <div style={{ fontSize: 62, fontWeight: 600, letterSpacing: -2, lineHeight: 1 }}>MiniMax M3</div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div
                style={{
                  fontSize: 84,
                  fontWeight: 600,
                  letterSpacing: -2,
                  lineHeight: 1,
                  color: c.accent,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                +23.2%
              </div>
              <div style={{ fontSize: 19, fontWeight: 500, color: c.muted, letterSpacing: 1, marginTop: 6 }}>
                WEEK OVER WEEK
              </div>
            </div>
          </div>
        </div>

        {/* column chart */}
        <div style={{ flex: 1, display: "flex", alignItems: "flex-end", marginTop: 30 }}>
          <div style={{ width: "100%", display: "flex", alignItems: "flex-end", gap: 30 }}>
            {weeks.map((w, i) => {
              const g = grow(i)
              const h = Math.round((w.t / AXIS_MAX) * CHART_H * g)
              return (
                <div key={w.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  {/* value + bar */}
                  <div style={{ position: "relative", width: "100%", height: CHART_H }}>
                    {/* dotted track */}
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: c.dot,
                        WebkitMaskImage: DOT_MASK,
                        maskImage: DOT_MASK,
                        WebkitMaskSize: "12px 12px",
                        maskSize: "12px 12px",
                        WebkitMaskRepeat: "repeat",
                        maskRepeat: "repeat",
                        WebkitMaskPosition: "left bottom",
                        maskPosition: "left bottom",
                      }}
                    />
                    {/* fill */}
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: h,
                        background: w.latest ? c.accent : c.accentDim,
                        borderTop: w.latest ? `3px solid ${c.accentHi}` : "none",
                      }}
                    />
                    {/* value label */}
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: h + 10,
                        textAlign: "center",
                        fontSize: 26,
                        fontWeight: w.latest ? 600 : 500,
                        color: w.latest ? c.accent : c.muted,
                        fontVariantNumeric: "tabular-nums",
                        opacity: interpolate(g, [0.5, 1], [0, 1], {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                        }),
                      }}
                    >
                      {w.t.toFixed(2)}T
                    </div>
                  </div>
                  {/* week label */}
                  <div
                    style={{
                      marginTop: 14,
                      fontSize: 18,
                      fontWeight: 500,
                      color: w.latest ? c.ink : c.faint,
                    }}
                  >
                    {w.label}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 22,
            paddingTop: 22,
            borderTop: `1px solid ${c.line}`,
            fontSize: 20,
            fontWeight: 500,
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: 9, color: c.muted }}>
            <span style={{ width: 13, height: 13, background: c.accent, display: "inline-block" }} />
            2.56T tokens last week · +482.3B added
          </div>
          <div style={{ color: c.ink }}>opencode.ai/data</div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
