import React from "react"
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion"

const c = {
  white: "#ffffff",
  dim: "rgba(255,255,255,0.72)",
  faint: "rgba(255,255,255,0.55)",
}
const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

// verified: NZ OpenCode Go, week of Jun 22-28, 2026 (2026-W26)
const TOKENS = 40_915_594_381 // 40.9B
const SHEEP = 23_600_000 // 23.6M
const PER_SHEEP = Math.round(TOKENS / SHEEP) // 1,734
const nf = new Intl.NumberFormat("en-US")

// the correct opencode "DATA" wordmark (white, over photo)
function DataWordmark({ height = 30 }: { height?: number }) {
  return (
    <svg width={(height * 66) / 20} height={height} viewBox="0 0 66 20" fill="none" style={{ color: c.white }}>
      <path opacity="0.35" d="M12 16H4V8H12V16Z" fill="currentColor" />
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

export function NZSheep() {
  const frame = useCurrentFrame()

  const count = Math.round(
    PER_SHEEP *
      interpolate(frame, [18, 90], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      }),
  )

  // slow Ken Burns push-in (scale up only — never reveals an edge)
  const zoom = interpolate(frame, [0, 150], [1.06, 1.12], {
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  })

  return (
    <AbsoluteFill style={{ background: "#0c0c0c", overflow: "hidden" }}>
      {/* the sheep, staring */}
      <Img
        src={staticFile("sheep.jpg")}
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center 38%",
          transform: `scale(${zoom})`,
          transformOrigin: "center 35%",
        }}
      />

      {/* legibility scrims */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 48%, rgba(0,0,0,0.78) 100%)",
        }}
      />

      {/* content */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          boxSizing: "border-box",
          padding: 64,
          color: c.white,
          fontFamily: MONO,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <DataWordmark height={30} />
          <div style={{ fontSize: 20, fontWeight: 500, color: c.dim, letterSpacing: 1 }}>JUN 22–28, 2026</div>
        </div>

        {/* bottom block */}
        <div>
          <div style={{ fontSize: 23, fontWeight: 600, color: c.dim, letterSpacing: 2, marginBottom: 8 }}>
            OPENCODE GO · NEW ZEALAND
          </div>
          <div
            style={{
              fontSize: 168,
              fontWeight: 600,
              lineHeight: 0.92,
              letterSpacing: -5,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {nf.format(count)}
          </div>
          <div style={{ fontSize: 50, fontWeight: 600, letterSpacing: -1, marginTop: 4 }}>tokens per sheep</div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 34,
              fontSize: 20,
              fontWeight: 500,
            }}
          >
            <div style={{ color: c.dim }}>40.9B tokens ÷ 23.6M sheep · last week</div>
            <div style={{ color: c.white }}>opencode.ai/data</div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
