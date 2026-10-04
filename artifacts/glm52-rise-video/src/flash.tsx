import React from "react"
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"

// stats.opencode.ai design tokens (light theme)
const c = {
  bg: "#ffffff",
  ink: "#161616",
  muted: "#5c5c5c",
  faint: "#808080",
  line: "#e6e6e6",
  dot: "#e4e4e4",
  gray: "#aab0b8",
  accent: "#3b5cf6",
  accentHi: "#5b78ff",
}
const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

const DOT_MASK =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 6 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0H2V2H0V0Z' fill='black'/%3E%3C/svg%3E\")"

// verified: OpenCode Go, week of Jun 22-28, 2026 (2026-W26). share = % of 19.64T total Go tokens.
const bars = [
  { label: "deepseek-v4-flash", share: 48.3, hero: true },
  { label: "deepseek-v4-pro", share: 19.4 },
  { label: "minimax-m3", share: 13.0 },
  { label: "glm-5.2", share: 8.3 },
  { label: "mimo-v2.5", share: 4.3 },
  { label: "kimi-k2.7-code", share: 2.6 },
  { label: "other models", share: 4.1 },
]

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

export function FlashShare() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const grow = (i: number) =>
    Math.min(
      1,
      Math.max(0, spring({ frame: frame - 18 - i * 7, fps, config: { damping: 18, stiffness: 120, mass: 0.6 } })),
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
            OPENCODE GO · SHARE OF TOKENS
          </div>
          <div
            style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 24, marginTop: 14 }}
          >
            <div style={{ fontSize: 62, fontWeight: 600, letterSpacing: -2, lineHeight: 1 }}>DeepSeek V4 Flash</div>
            <div
              style={{
                fontSize: 88,
                fontWeight: 600,
                letterSpacing: -2,
                lineHeight: 1,
                color: c.accent,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              48%
            </div>
          </div>
        </div>

        {/* bar chart */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 16 }}>
          {bars.map((b, i) => {
            const g = grow(i)
            const pct = b.share * g
            return (
              <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 18 }}>
                <div
                  style={{
                    width: 268,
                    fontSize: 23,
                    fontWeight: b.hero ? 600 : 500,
                    color: b.hero ? c.ink : c.muted,
                    textAlign: "right",
                    whiteSpace: "nowrap",
                  }}
                >
                  {b.label}
                </div>
                <div style={{ position: "relative", flex: 1, height: 48 }}>
                  {/* dotted 100% track — height is a multiple of the 12px tile, anchored bottom, so dots never clip */}
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
                      top: 0,
                      bottom: 0,
                      width: `${pct}%`,
                      background: b.hero ? c.accent : c.gray,
                      borderRight: b.hero ? `2px solid ${c.accentHi}` : "none",
                    }}
                  />
                </div>
                <div
                  style={{
                    width: 84,
                    fontSize: 24,
                    fontWeight: b.hero ? 600 : 500,
                    color: b.hero ? c.accent : c.muted,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {Math.round(pct)}%
                </div>
              </div>
            )
          })}
        </div>

        {/* footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 24,
            paddingTop: 22,
            borderTop: `1px solid ${c.line}`,
            fontSize: 20,
            fontWeight: 500,
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: 9, color: c.muted }}>
            <span style={{ width: 13, height: 13, background: c.accent, display: "inline-block" }} />
            DeepSeek V4 Flash · 9.48T tokens · 83.6M requests
          </div>
          <div style={{ color: c.ink }}>opencode.ai/data</div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
