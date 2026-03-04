// @ts-nocheck
import { createSignal, createEffect, on, onMount, onCleanup } from "solid-js"
import { TextShimmer } from "./text-shimmer"
import { TextReveal } from "./text-reveal"

export default {
  title: "UI/ThinkingHeading",
  id: "components-thinking-heading",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: `### Overview
Playground for animating the secondary heading beside "Thinking".

Uses TextReveal for the production heading animation with tunable
duration, travel, bounce, and fade controls.`,
      },
    },
  },
}

const HEADINGS = [
  "Planning key generation details",
  "Analyzing error handling",
  undefined,
  "Reviewing authentication flow",
  "Considering edge cases",
  "Evaluating performance",
  "Structuring the response",
  "Checking type safety",
  "Designing the API surface",
  "Mapping dependencies",
  "Outlining test strategy",
]

// ---------------------------------------------------------------------------
// CSS
//
// Custom properties driven by sliders:
//   --h-duration       transition duration (e.g. "600ms")
//   --h-duration-raw   unitless number for calc (e.g. "600")
//   --h-blur           blur radius (e.g. "4px")
//   --h-travel         vertical travel distance (e.g. "18px")
//   --h-spring         full cubic-bezier for movement (set from bounce slider)
//   --h-spring-soft    softer version for width transitions
//   --h-mask-size      fade depth at top/bottom of odometer mask
//   --h-mask-pad       base padding-block on odometer track
//   --h-mask-height    extra vertical mask area per side
//   --h-mask-bg        background color for fade overlays
// ---------------------------------------------------------------------------

const STYLES = `
/* ── shared base ────────────────────────────────────────────────── */
[data-variant] {
  display: inline-flex;
  align-items: center;
}

[data-variant] [data-slot="track"] {
  display: grid;
  overflow: visible;
  min-height: 20px;
  justify-items: start;
  align-items: center;
  transition: width var(--h-duration, 600ms) var(--h-spring-soft, cubic-bezier(0.34, 1.1, 0.64, 1));
}

[data-variant] [data-slot="entering"],
[data-variant] [data-slot="leaving"] {
  grid-area: 1 / 1;
  line-height: 20px;
  white-space: nowrap;
  justify-self: start;
}

/* kill transitions before fonts are ready */
[data-variant][data-ready="false"] [data-slot="track"],
[data-variant][data-ready="false"] [data-slot="entering"],
[data-variant][data-ready="false"] [data-slot="leaving"] {
  transition-duration: 0ms !important;
}


/* ── 1. spring-up ───────────────────────────────────────────────── *
 * New text rises from below, old text exits upward.               */

[data-variant="spring-up"] [data-slot="entering"],
[data-variant="spring-up"] [data-slot="leaving"] {
  transition-property: transform, opacity, filter;
  transition-duration:
    var(--h-duration, 600ms),
    calc(var(--h-duration-raw, 600) * 0.6 * 1ms),
    calc(var(--h-duration-raw, 600) * 0.5 * 1ms);
  transition-timing-function: var(--h-spring), ease-out, ease-out;
}
[data-variant="spring-up"] [data-slot="entering"] {
  transform: translateY(0);
  opacity: 1;
  filter: blur(0);
}
[data-variant="spring-up"] [data-slot="leaving"] {
  transform: translateY(calc(var(--h-travel, 18px) * -1));
  opacity: 0;
  filter: blur(var(--h-blur, 0px));
}
[data-variant="spring-up"][data-swapping="true"] [data-slot="entering"] {
  transform: translateY(var(--h-travel, 18px));
  opacity: 0;
  filter: blur(var(--h-blur, 0px));
  transition-duration: 0ms !important;
}
[data-variant="spring-up"][data-swapping="true"] [data-slot="leaving"] {
  transform: translateY(0);
  opacity: 1;
  filter: blur(0);
  transition-duration: 0ms !important;
}


/* ── 2. spring-down ─────────────────────────────────────────────── *
 * New text drops from above, old text exits downward.             */

[data-variant="spring-down"] [data-slot="entering"],
[data-variant="spring-down"] [data-slot="leaving"] {
  transition-property: transform, opacity, filter;
  transition-duration:
    var(--h-duration, 600ms),
    calc(var(--h-duration-raw, 600) * 0.6 * 1ms),
    calc(var(--h-duration-raw, 600) * 0.5 * 1ms);
  transition-timing-function: var(--h-spring), ease-out, ease-out;
}
[data-variant="spring-down"] [data-slot="entering"] {
  transform: translateY(0);
  opacity: 1;
  filter: blur(0);
}
[data-variant="spring-down"] [data-slot="leaving"] {
  transform: translateY(var(--h-travel, 18px));
  opacity: 0;
  filter: blur(var(--h-blur, 0px));
}
[data-variant="spring-down"][data-swapping="true"] [data-slot="entering"] {
  transform: translateY(calc(var(--h-travel, 18px) * -1));
  opacity: 0;
  filter: blur(var(--h-blur, 0px));
  transition-duration: 0ms !important;
}
[data-variant="spring-down"][data-swapping="true"] [data-slot="leaving"] {
  transform: translateY(0);
  opacity: 1;
  filter: blur(0);
  transition-duration: 0ms !important;
}


/* ── 3. spring-pop ──────────────────────────────────────────────── *
 * Scale + slight vertical shift + blur. Playful, bouncy.          */

[data-variant="spring-pop"] [data-slot="entering"],
[data-variant="spring-pop"] [data-slot="leaving"] {
  transition-property: transform, opacity, filter;
  transition-duration:
    var(--h-duration, 600ms),
    calc(var(--h-duration-raw, 600) * 0.55 * 1ms),
    calc(var(--h-duration-raw, 600) * 0.55 * 1ms);
  transition-timing-function: var(--h-spring), ease-out, ease-out;
  transform-origin: left center;
}
[data-variant="spring-pop"] [data-slot="entering"] {
  transform: translateY(0) scale(1);
  opacity: 1;
  filter: blur(0);
}
[data-variant="spring-pop"] [data-slot="leaving"] {
  transform: translateY(calc(var(--h-travel, 18px) * -0.35)) scale(0.92);
  opacity: 0;
  filter: blur(var(--h-blur, 3px));
}
[data-variant="spring-pop"][data-swapping="true"] [data-slot="entering"] {
  transform: translateY(calc(var(--h-travel, 18px) * 0.35)) scale(0.92);
  opacity: 0;
  filter: blur(var(--h-blur, 3px));
  transition-duration: 0ms !important;
}
[data-variant="spring-pop"][data-swapping="true"] [data-slot="leaving"] {
  transform: translateY(0) scale(1);
  opacity: 1;
  filter: blur(0);
  transition-duration: 0ms !important;
}


/* ── 4. spring-blur ─────────────────────────────────────────────── *
 * Pure crossfade with heavy blur. No vertical movement.           *
 * Width still animates with spring.                               */

[data-variant="spring-blur"] [data-slot="entering"],
[data-variant="spring-blur"] [data-slot="leaving"] {
  transition-property: opacity, filter;
  transition-duration:
    calc(var(--h-duration-raw, 600) * 0.75 * 1ms),
    var(--h-duration, 600ms);
  transition-timing-function: ease-out, var(--h-spring-soft);
}
[data-variant="spring-blur"] [data-slot="entering"] {
  opacity: 1;
  filter: blur(0);
}
[data-variant="spring-blur"] [data-slot="leaving"] {
  opacity: 0;
  filter: blur(calc(var(--h-blur, 4px) * 2));
}
[data-variant="spring-blur"][data-swapping="true"] [data-slot="entering"] {
  opacity: 0;
  filter: blur(calc(var(--h-blur, 4px) * 2));
  transition-duration: 0ms !important;
}
[data-variant="spring-blur"][data-swapping="true"] [data-slot="leaving"] {
  opacity: 1;
  filter: blur(0);
  transition-duration: 0ms !important;
}


/* ── 5. odometer ──────────────────────────────────────────────── *
 * Both texts scroll vertically through a clipped track.           *
 *                                                                 *
 * overflow:hidden clips at the padding-box edge.                  *
 * mask-image fades to transparent at that same edge.              *
 * Result: content is invisible at the clip boundary → no hard     *
 * edge ever visible. Padding + mask height extend the clip area   *
 * so text has room to travel through the gradient fade zone.       *
 *                                                                 *
 * Uses transparent→white which works in both alpha & luminance    *
 * mask modes (transparent=hidden, white=visible in both).         */

[data-variant="odometer"] [data-slot="track"] {
  --h-mask-stop: min(var(--h-mask-size, 20px), calc(50% - 0.5px));
  --h-odo-shift: calc(
    100% + var(--h-travel, 18px) + var(--h-mask-height, 0px) + max(calc(var(--h-mask-pad, 28px) - 28px), 0px)
  );
  position: relative;
  align-items: stretch;
  overflow: hidden;
  padding-block: calc(var(--h-mask-pad, 28px) + var(--h-mask-height, 0px));
  margin-block: calc((var(--h-mask-pad, 28px) + var(--h-mask-height, 0px)) * -1);
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0px,
    white var(--h-mask-stop),
    white calc(100% - var(--h-mask-stop)),
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0px,
    white var(--h-mask-stop),
    white calc(100% - var(--h-mask-stop)),
    transparent 100%
  );
  transition: width var(--h-duration, 600ms) var(--h-spring-soft, cubic-bezier(0.34, 1.1, 0.64, 1));
}

/* on swap, jump width instantly to the max of both texts */
[data-variant="odometer"][data-swapping="true"] [data-slot="track"] {
  transition-duration: 0ms !important;
}

[data-variant="odometer"] [data-slot="entering"],
[data-variant="odometer"] [data-slot="leaving"] {
  transition-property: transform;
  transition-duration: var(--h-duration, 600ms);
  transition-timing-function: var(--h-spring);
  opacity: 1;
}
/* settled: entering in view, leaving pushed below */
[data-variant="odometer"] [data-slot="entering"] {
  transform: translateY(0);
}
[data-variant="odometer"] [data-slot="leaving"] {
  transform: translateY(var(--h-odo-shift));
}
/* swapping: snap entering above, leaving in-place */
[data-variant="odometer"][data-swapping="true"] [data-slot="entering"] {
  transform: translateY(calc(var(--h-odo-shift) * -1));
  transition-duration: 0ms !important;
}
[data-variant="odometer"][data-swapping="true"] [data-slot="leaving"] {
  transform: translateY(0);
  transition-duration: 0ms !important;
}

/* ── odometer + blur ──────────────────────────────────────────── *
 * Optional: adds opacity + blur transitions on top of the         *
 * positional odometer movement.                                   */

[data-variant="odometer"][data-odo-blur="true"] [data-slot="entering"],
[data-variant="odometer"][data-odo-blur="true"] [data-slot="leaving"] {
  transition-property: transform, opacity, filter;
  transition-duration:
    var(--h-duration, 600ms),
    calc(var(--h-duration-raw, 600) * 0.6 * 1ms),
    calc(var(--h-duration-raw, 600) * 0.5 * 1ms);
}
[data-variant="odometer"][data-odo-blur="true"] [data-slot="entering"] {
  opacity: 1;
  filter: blur(0);
}
[data-variant="odometer"][data-odo-blur="true"] [data-slot="leaving"] {
  opacity: 0;
  filter: blur(var(--h-blur, 4px));
}
[data-variant="odometer"][data-odo-blur="true"][data-swapping="true"] [data-slot="entering"] {
  opacity: 0;
  filter: blur(var(--h-blur, 4px));
}
[data-variant="odometer"][data-odo-blur="true"][data-swapping="true"] [data-slot="leaving"] {
  opacity: 1;
  filter: blur(0);
}

/* ── debug: show fade zones ───────────────────────────────────── */
[data-variant="odometer"][data-debug="true"] [data-slot="track"] {
  outline: 1px dashed rgba(255, 0, 0, 0.6);
}
[data-variant="odometer"][data-debug="true"] [data-slot="track"]::before,
[data-variant="odometer"][data-debug="true"] [data-slot="track"]::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: var(--h-mask-stop);
  pointer-events: none;
}
[data-variant="odometer"][data-debug="true"] [data-slot="track"]::before {
  top: 0;
  background: linear-gradient(to bottom, rgba(255, 0, 0, 0.3), transparent);
}
[data-variant="odometer"][data-debug="true"] [data-slot="track"]::after {
  bottom: 0;
  background: linear-gradient(to top, rgba(255, 0, 0, 0.3), transparent);
}


/* ── slider styling ─────────────────────────────────────────────── */
input[type="range"].heading-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 140px;
  height: 4px;
  border-radius: 2px;
  background: var(--color-divider, #444);
  outline: none;
}
input[type="range"].heading-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--color-accent, #58f);
  cursor: pointer;
  border: none;
}
`

// ---------------------------------------------------------------------------
// Animated heading component
//
// Width is measured via scrollWidth (NOT Range.getBoundingClientRect) because
// getBoundingClientRect includes CSS transforms — so scale(0.92) during the
// swap phase would measure 92% of the real width and permanently clip text.
// scrollWidth returns the layout/intrinsic width, unaffected by transforms.
// ---------------------------------------------------------------------------

function AnimatedHeading(props) {
  const [current, setCurrent] = createSignal(props.text)
  const [leaving, setLeaving] = createSignal(undefined)
  const [width, setWidth] = createSignal("auto")
  const [ready, setReady] = createSignal(false)
  const [swapping, setSwapping] = createSignal(false)
  let enterRef
  let leaveRef
  let containerRef
  let frame

  const measureEnter = () => enterRef?.scrollWidth ?? 0
  const measureLeave = () => leaveRef?.scrollWidth ?? 0
  const widen = (px) => {
    if (px <= 0) return
    const w = Number.parseFloat(width())
    if (Number.isFinite(w) && px <= w) return
    setWidth(`${px}px`)
  }

  const measure = () => {
    if (!current()) {
      setWidth("0px")
      return
    }
    const px = measureEnter()
    if (px > 0) setWidth(`${px}px`)
  }

  createEffect(
    on(
      () => props.text,
      (next, prev) => {
        if (next === prev) return
        setSwapping(true)
        setLeaving(prev)
        setCurrent(next)

        if (frame) cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          // For odometer keep width as a grow-only max so heading never shrinks.
          if (props.variant === "odometer") {
            const enterW = measureEnter()
            const leaveW = measureLeave()
            widen(Math.max(enterW, leaveW))
            containerRef?.offsetHeight // reflow with max width + swap positions
            setSwapping(false)
          } else {
            containerRef?.offsetHeight
            setSwapping(false)
            measure()
          }
          frame = undefined
        })
      },
    ),
  )

  onMount(() => {
    measure()
    document.fonts?.ready.finally(() => {
      measure()
      requestAnimationFrame(() => setReady(true))
    })
  })

  onCleanup(() => {
    if (frame) cancelAnimationFrame(frame)
  })

  return (
    <span
      ref={containerRef}
      data-variant={props.variant}
      data-ready={ready()}
      data-swapping={swapping()}
      data-debug={props.debug ? "true" : undefined}
      data-odo-blur={props.odoBlur ? "true" : undefined}
    >
      <span data-slot="track" style={{ width: width() }}>
        <span data-slot="entering" ref={enterRef}>
          {current() ?? "\u00A0"}
        </span>
        <span data-slot="leaving" ref={leaveRef}>
          {leaving() ?? "\u00A0"}
        </span>
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Button / layout styles
// ---------------------------------------------------------------------------

const btn = (accent) => ({
  padding: "6px 14px",
  "border-radius": "6px",
  border: "1px solid var(--color-divider, #333)",
  background: accent ? "var(--color-danger-fill, #c33)" : "var(--color-fill-element, #222)",
  color: "var(--color-text, #eee)",
  cursor: "pointer",
  "font-size": "13px",
})

const smallBtn = (active) => ({
  padding: "4px 12px",
  "border-radius": "6px",
  border: active ? "1px solid var(--color-accent, #58f)" : "1px solid var(--color-divider, #333)",
  background: active ? "var(--color-accent, #58f)" : "var(--color-fill-element, #222)",
  color: "var(--color-text, #eee)",
  cursor: "pointer",
  "font-size": "12px",
})

const sliderLabel = {
  "font-size": "11px",
  "font-family": "monospace",
  color: "var(--color-text-weak, #666)",
  "min-width": "70px",
  "flex-shrink": "0",
  "text-align": "right",
}

const sliderValue = {
  "font-family": "monospace",
  "font-size": "11px",
  color: "var(--color-text-weak, #aaa)",
  "min-width": "60px",
}

const cardLabel = {
  "font-size": "11px",
  "font-family": "monospace",
  color: "var(--color-text-weak, #666)",
}

const thinkingRow = {
  display: "flex",
  "align-items": "center",
  gap: "8px",
  "min-width": "0",
  "font-size": "14px",
  "font-weight": "500",
  "line-height": "20px",
  "min-height": "20px",
  color: "var(--text-weak, #aaa)",
}

const headingSlot = {
  "min-width": "0",
  overflow: "visible",
  "white-space": "nowrap",
  color: "var(--text-weaker, #888)",
  "font-weight": "400",
}

const cardStyle = {
  padding: "16px 20px",
  "border-radius": "10px",
  border: "1px solid var(--color-divider, #333)",
  background: "var(--h-mask-bg, #1a1a1a)",
  display: "grid",
  gap: "8px",
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const VARIANTS: { key: string; label: string }[] = []

// ---------------------------------------------------------------------------
// Story
// ---------------------------------------------------------------------------

export const Playground = {
  render: () => {
    const [heading, setHeading] = createSignal(HEADINGS[0])
    const [headingIndex, setHeadingIndex] = createSignal(0)
    const [active, setActive] = createSignal(true)
    const [cycling, setCycling] = createSignal(false)
    let cycleTimer

    // tunable params
    const [duration, setDuration] = createSignal(550)
    const [blur, setBlur] = createSignal(2)
    const [travel, setTravel] = createSignal(4)
    const [bounce, setBounce] = createSignal(1.35)
    const [maskSize, setMaskSize] = createSignal(12)
    const [maskPad, setMaskPad] = createSignal(9)
    const [maskHeight, setMaskHeight] = createSignal(0)
    const [debug, setDebug] = createSignal(false)
    const [odoBlur, setOdoBlur] = createSignal(false)

    const nextHeading = () => {
      setHeadingIndex((i) => {
        const next = (i + 1) % HEADINGS.length
        setHeading(HEADINGS[next])
        return next
      })
    }

    const prevHeading = () => {
      setHeadingIndex((i) => {
        const prev = (i - 1 + HEADINGS.length) % HEADINGS.length
        setHeading(HEADINGS[prev])
        return prev
      })
    }

    const toggleCycling = () => {
      if (cycling()) {
        clearTimeout(cycleTimer)
        cycleTimer = undefined
        setCycling(false)
        return
      }
      setCycling(true)
      const tick = () => {
        if (!cycling()) return
        nextHeading()
        cycleTimer = setTimeout(tick, 850 + Math.floor(Math.random() * 550))
      }
      cycleTimer = setTimeout(tick, 850 + Math.floor(Math.random() * 550))
    }

    const clearHeading = () => {
      setHeading(undefined)
      if (cycling()) {
        clearTimeout(cycleTimer)
        cycleTimer = undefined
        setCycling(false)
      }
    }

    onCleanup(() => {
      if (cycleTimer) clearTimeout(cycleTimer)
    })

    const vars = () => ({
      "--h-duration": `${duration()}ms`,
      "--h-duration-raw": `${duration()}`,
      "--h-blur": `${blur()}px`,
      "--h-travel": `${travel()}px`,
      "--h-spring": `cubic-bezier(0.34, ${bounce()}, 0.64, 1)`,
      "--h-spring-soft": `cubic-bezier(0.34, ${Math.max(bounce() * 0.7, 1)}, 0.64, 1)`,
      "--h-mask-size": `${maskSize()}px`,
      "--h-mask-pad": `${maskPad()}px`,
      "--h-mask-height": `${maskHeight()}px`,
      "--h-mask-bg": "#1a1a1a",
    })

    return (
      <div style={{ display: "grid", gap: "24px", padding: "20px", "max-width": "820px", ...vars() }}>
        <style>{STYLES}</style>

        {/* ── Variant cards ─────────────────────────────────── */}
        <div style={{ display: "grid", "grid-template-columns": "1fr", gap: "16px" }}>
          <div style={cardStyle}>
            <span style={cardLabel}>TextReveal (production)</span>
            <span style={thinkingRow}>
              <TextShimmer text="Thinking" active={active()} />
              <span style={headingSlot}>
                <TextReveal
                  text={heading()}
                  duration={duration()}
                  travel={25}
                  edge={17}
                  spring={`cubic-bezier(0.34, ${bounce()}, 0.64, 1)`}
                  springSoft={`cubic-bezier(0.34, ${Math.max(bounce() * 0.7, 1)}, 0.64, 1)`}
                  growOnly
                />
              </span>
            </span>
          </div>
          {VARIANTS.map((v) => (
            <div style={cardStyle}>
              <span style={cardLabel}>{v.label}</span>
              <span style={thinkingRow}>
                <TextShimmer text="Thinking" active={active()} />
                <span style={headingSlot}>
                  <AnimatedHeading
                    text={heading()}
                    variant={v.key}
                    debug={v.key === "odometer" && debug()}
                    odoBlur={v.key === "odometer" && odoBlur()}
                  />
                </span>
              </span>
            </div>
          ))}
        </div>

        {/* ── Sliders ──────────────────────────────────────── */}
        <div
          style={{
            "border-top": "1px solid var(--color-divider, #333)",
            "padding-top": "16px",
            display: "grid",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>duration</span>
            <input
              type="range"
              class="heading-slider"
              min={200}
              max={1400}
              step={50}
              value={duration()}
              onInput={(e) => setDuration(Number(e.currentTarget.value))}
            />
            <span style={sliderValue}>{duration()}ms</span>
          </div>

          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>blur</span>
            <input
              type="range"
              class="heading-slider"
              min={0}
              max={16}
              step={0.5}
              value={blur()}
              onInput={(e) => setBlur(Number(e.currentTarget.value))}
            />
            <span style={sliderValue}>{blur()}px</span>
          </div>

          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>travel</span>
            <input
              type="range"
              class="heading-slider"
              min={4}
              max={120}
              step={1}
              value={travel()}
              onInput={(e) => setTravel(Number(e.currentTarget.value))}
            />
            <span style={sliderValue}>{travel()}px</span>
          </div>

          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>bounce</span>
            <input
              type="range"
              class="heading-slider"
              min={1}
              max={2.2}
              step={0.05}
              value={bounce()}
              onInput={(e) => setBounce(Number(e.currentTarget.value))}
            />
            <span style={sliderValue}>
              {bounce().toFixed(2)} {bounce() <= 1.05 ? "(none)" : bounce() >= 1.9 ? "(heavy)" : ""}
            </span>
          </div>

          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>mask</span>
            <input
              type="range"
              class="heading-slider"
              min={0}
              max={50}
              step={1}
              value={maskSize()}
              onInput={(e) => setMaskSize(Number(e.currentTarget.value))}
            />
            <span style={sliderValue}>
              {maskSize()}px {maskSize() === 0 ? "(hard)" : ""}
            </span>
          </div>

          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>mask pad</span>
            <input
              type="range"
              class="heading-slider"
              min={0}
              max={60}
              step={1}
              value={maskPad()}
              onInput={(e) => setMaskPad(Number(e.currentTarget.value))}
            />
            <span style={sliderValue}>{maskPad()}px</span>
          </div>

          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>mask height</span>
            <input
              type="range"
              class="heading-slider"
              min={0}
              max={80}
              step={1}
              value={maskHeight()}
              onInput={(e) => setMaskHeight(Number(e.currentTarget.value))}
            />
            <span style={sliderValue}>{maskHeight()}px</span>
          </div>
        </div>

        {/* ── Controls ─────────────────────────────────────── */}
        <div style={{ display: "grid", gap: "12px" }}>
          <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
            <button onClick={toggleCycling} style={btn(cycling())}>
              {cycling() ? "Stop sim" : "Simulate jitter"}
            </button>
            <button onClick={prevHeading} style={btn()}>
              Prev
            </button>
            <button onClick={nextHeading} style={btn()}>
              Next
            </button>
            <button onClick={clearHeading} style={btn()}>
              Clear
            </button>
            <button onClick={() => setActive((v) => !v)} style={smallBtn(active())}>
              {active() ? "Shimmer: on" : "Shimmer: off"}
            </button>
            <button onClick={() => setDebug((v) => !v)} style={smallBtn(debug())}>
              {debug() ? "Debug mask: on" : "Debug mask"}
            </button>
            <button onClick={() => setOdoBlur((v) => !v)} style={smallBtn(odoBlur())}>
              {odoBlur() ? "Odo blur: on" : "Odo blur"}
            </button>
          </div>

          <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
            {HEADINGS.map((h, i) => (
              <button
                onClick={() => {
                  setHeadingIndex(i)
                  setHeading(h)
                }}
                style={smallBtn(headingIndex() === i)}
              >
                {h ?? "(no submessage)"}
              </button>
            ))}
          </div>

          <div
            style={{
              "font-size": "11px",
              color: "var(--color-text-weak, #888)",
              "font-family": "monospace",
            }}
          >
            heading: {heading() ?? "(none)"} · sim: {cycling() ? "on" : "off"} · bounce: {bounce().toFixed(2)} ·
            odo-blur: {odoBlur() ? "on" : "off"}
          </div>
        </div>
      </div>
    )
  },
}
