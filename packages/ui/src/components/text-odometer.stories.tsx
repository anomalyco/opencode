// @ts-nocheck
import { createSignal, onCleanup } from "solid-js"
import { TextOdometer } from "./text-odometer"
import { TextReveal } from "./text-reveal"

export default {
  title: "UI/TextOdometer",
  id: "components-text-odometer",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: `### Overview
Playground comparing three text transition styles:

**TextOdometer** — slot-machine: text slides vertically through a fixed gradient mask.

**TextReveal (wipe)** — pure mask wipe: gradient sweeps bottom-to-top, text stays in place.

**TextReveal (hybrid)** — mask wipe + vertical slide: gradient sweeps AND text moves downward.`,
      },
    },
  },
}

const TEXTS = [
  "Refactor ToolStatusTitle DOM measurement",
  "Remove inline measure nodes",
  "Run typechecks and report changes",
  "Verify reduced-motion behavior",
  "Review diff for animation edge cases",
  "Check keyboard semantics",
  undefined,
  "Planning key generation details",
  "Analyzing error handling",
  "Considering edge cases",
]

const btn = (accent?: boolean) =>
  ({
    padding: "5px 12px",
    "border-radius": "6px",
    border: accent ? "1px solid var(--color-accent, #58f)" : "1px solid var(--color-divider, #333)",
    background: accent ? "var(--color-accent, #58f)" : "var(--color-fill-element, #222)",
    color: "var(--color-text, #eee)",
    cursor: "pointer",
    "font-size": "12px",
  }) as const

const sliderLabel = {
  width: "90px",
  "font-size": "12px",
  color: "var(--color-text-secondary, #a3a3a3)",
  "flex-shrink": "0",
} as const

const cardStyle = {
  padding: "20px 24px",
  "border-radius": "10px",
  border: "1px solid var(--color-divider, #333)",
  background: "var(--color-fill-element, #1a1a1a)",
  display: "grid",
  gap: "12px",
} as const

const cardLabel = {
  "font-size": "11px",
  "font-family": "monospace",
  color: "var(--color-text-weak, #666)",
} as const

const previewRow = {
  display: "flex",
  "align-items": "center",
  gap: "8px",
  "font-size": "14px",
  "font-weight": "500",
  "line-height": "20px",
  color: "var(--text-weak, #aaa)",
  "min-height": "20px",
  overflow: "visible",
} as const

const headingSlot = {
  "min-width": "0",
  overflow: "visible",
  color: "var(--text-weaker, #888)",
  "font-weight": "400",
} as const

export const Playground = {
  render: () => {
    const [index, setIndex] = createSignal(0)
    const [cycling, setCycling] = createSignal(false)
    const [growOnly, setGrowOnly] = createSignal(true)

    // shared
    const [duration, setDuration] = createSignal(600)
    const [bounce, setBounce] = createSignal(1.0)
    const [bounceSoft, setBounceSoft] = createSignal(1.0)

    // odometer-specific
    const [travel, setTravel] = createSignal(4)
    const [mask, setMask] = createSignal(12)
    const [pad, setPad] = createSignal(9)
    const [height, setHeight] = createSignal(0)

    // reveal-specific
    const [edge, setEdge] = createSignal(17)
    const [revealTravel, setRevealTravel] = createSignal(0)

    // hybrid-specific
    const [hybridTravel, setHybridTravel] = createSignal(25)
    const [hybridEdge, setHybridEdge] = createSignal(17)

    let timer: number | undefined

    const text = () => TEXTS[index()]

    const next = () => {
      setIndex((i) => (i + 1) % TEXTS.length)
    }

    const prev = () => {
      setIndex((i) => (i - 1 + TEXTS.length) % TEXTS.length)
    }

    const toggleCycle = () => {
      if (cycling()) {
        if (timer) clearTimeout(timer)
        timer = undefined
        setCycling(false)
        return
      }
      setCycling(true)
      const tick = () => {
        next()
        timer = window.setTimeout(tick, 700 + Math.floor(Math.random() * 600))
      }
      timer = window.setTimeout(tick, 700 + Math.floor(Math.random() * 600))
    }

    onCleanup(() => {
      if (timer) clearTimeout(timer)
    })

    const spring = () => `cubic-bezier(0.34, ${bounce()}, 0.64, 1)`
    const springSoft = () => `cubic-bezier(0.34, ${bounceSoft()}, 0.64, 1)`

    return (
      <div style={{ display: "grid", gap: "24px", padding: "20px", "max-width": "700px" }}>
        {/* ── preview cards ── */}
        <div style={{ display: "grid", gap: "16px" }}>
          {/* hybrid card — first */}
          <div style={cardStyle}>
            <span style={cardLabel}>text-reveal (mask wipe + slide)</span>
            <div style={previewRow}>
              <span>Thinking</span>
              <span style={headingSlot}>
                <TextReveal
                  class="text-14-regular"
                  text={text()}
                  duration={duration()}
                  edge={hybridEdge()}
                  travel={hybridTravel()}
                  spring={spring()}
                  springSoft={springSoft()}
                  growOnly={growOnly()}
                />
              </span>
            </div>
          </div>

          {/* odometer card */}
          <div style={cardStyle}>
            <span style={cardLabel}>text-odometer (slide through mask)</span>
            <div style={previewRow}>
              <span>Thinking</span>
              <span style={headingSlot}>
                <TextOdometer
                  class="text-14-regular"
                  text={text()}
                  duration={duration()}
                  travel={travel()}
                  mask={mask()}
                  pad={pad()}
                  height={height()}
                  spring={spring()}
                  springSoft={springSoft()}
                  growOnly={growOnly()}
                />
              </span>
            </div>
          </div>

          {/* reveal card */}
          <div style={cardStyle}>
            <span style={cardLabel}>text-reveal (mask wipe only)</span>
            <div style={previewRow}>
              <span>Thinking</span>
              <span style={headingSlot}>
                <TextReveal
                  class="text-14-regular"
                  text={text()}
                  duration={duration()}
                  edge={edge()}
                  travel={revealTravel()}
                  spring={spring()}
                  springSoft={springSoft()}
                  growOnly={growOnly()}
                />
              </span>
            </div>
          </div>
        </div>

        {/* ── text selector chips ── */}
        <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
          {TEXTS.map((t, i) => (
            <button onClick={() => setIndex(i)} style={btn(index() === i)}>
              {t ?? "(none)"}
            </button>
          ))}
        </div>

        {/* ── controls ── */}
        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
          <button onClick={prev} style={btn()}>Prev</button>
          <button onClick={next} style={btn()}>Next</button>
          <button onClick={toggleCycle} style={btn(cycling())}>
            {cycling() ? "Stop cycle" : "Auto cycle"}
          </button>
          <button onClick={() => setGrowOnly((v) => !v)} style={btn(growOnly())}>
            {growOnly() ? "growOnly: on" : "growOnly: off"}
          </button>
        </div>

        {/* ── sliders ── */}
        <div style={{ display: "grid", gap: "8px", "max-width": "480px" }}>
          {/* ── hybrid sliders — first ── */}
          <div style={{ "font-size": "11px", color: "var(--color-text-weak, #666)" }}>Hybrid (wipe + slide)</div>

          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>edge</span>
            <input type="range" min="1" max="40" step="1" value={hybridEdge()} onInput={(e) => setHybridEdge(e.currentTarget.valueAsNumber)} style={{ flex: 1 }} />
            <span style={{ width: "60px", "text-align": "right", "font-size": "12px" }}>{hybridEdge()}%</span>
          </label>

          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>travel</span>
            <input type="range" min="0" max="40" step="1" value={hybridTravel()} onInput={(e) => setHybridTravel(e.currentTarget.valueAsNumber)} style={{ flex: 1 }} />
            <span style={{ width: "60px", "text-align": "right", "font-size": "12px" }}>{hybridTravel()}px</span>
          </label>

          {/* ── shared sliders ── */}
          <div style={{ "font-size": "11px", color: "var(--color-text-weak, #666)", "margin-top": "8px" }}>Shared</div>

          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>duration</span>
            <input type="range" min="100" max="1400" step="10" value={duration()} onInput={(e) => setDuration(e.currentTarget.valueAsNumber)} style={{ flex: 1 }} />
            <span style={{ width: "60px", "text-align": "right", "font-size": "12px" }}>{duration()}ms</span>
          </label>

          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>bounce</span>
            <input type="range" min="1" max="2" step="0.01" value={bounce()} onInput={(e) => setBounce(e.currentTarget.valueAsNumber)} style={{ flex: 1 }} />
            <span style={{ width: "60px", "text-align": "right", "font-size": "12px" }}>{bounce().toFixed(2)}</span>
          </label>

          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>bounce soft</span>
            <input type="range" min="1" max="1.5" step="0.01" value={bounceSoft()} onInput={(e) => setBounceSoft(e.currentTarget.valueAsNumber)} style={{ flex: 1 }} />
            <span style={{ width: "60px", "text-align": "right", "font-size": "12px" }}>{bounceSoft().toFixed(2)}</span>
          </label>

          {/* ── odometer sliders ── */}
          <div style={{ "font-size": "11px", color: "var(--color-text-weak, #666)", "margin-top": "8px" }}>Odometer</div>

          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>travel</span>
            <input type="range" min="0" max="30" step="1" value={travel()} onInput={(e) => setTravel(e.currentTarget.valueAsNumber)} style={{ flex: 1 }} />
            <span style={{ width: "60px", "text-align": "right", "font-size": "12px" }}>{travel()}px</span>
          </label>

          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>mask</span>
            <input type="range" min="0" max="40" step="1" value={mask()} onInput={(e) => setMask(e.currentTarget.valueAsNumber)} style={{ flex: 1 }} />
            <span style={{ width: "60px", "text-align": "right", "font-size": "12px" }}>{mask()}px</span>
          </label>

          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>pad</span>
            <input type="range" min="0" max="40" step="1" value={pad()} onInput={(e) => setPad(e.currentTarget.valueAsNumber)} style={{ flex: 1 }} />
            <span style={{ width: "60px", "text-align": "right", "font-size": "12px" }}>{pad()}px</span>
          </label>

          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>mask height</span>
            <input type="range" min="0" max="20" step="1" value={height()} onInput={(e) => setHeight(e.currentTarget.valueAsNumber)} style={{ flex: 1 }} />
            <span style={{ width: "60px", "text-align": "right", "font-size": "12px" }}>{height()}px</span>
          </label>

          {/* ── reveal sliders ── */}
          <div style={{ "font-size": "11px", color: "var(--color-text-weak, #666)", "margin-top": "8px" }}>Reveal (wipe only)</div>

          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>edge</span>
            <input type="range" min="1" max="40" step="1" value={edge()} onInput={(e) => setEdge(e.currentTarget.valueAsNumber)} style={{ flex: 1 }} />
            <span style={{ width: "60px", "text-align": "right", "font-size": "12px" }}>{edge()}%</span>
          </label>

          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>travel</span>
            <input type="range" min="0" max="16" step="1" value={revealTravel()} onInput={(e) => setRevealTravel(e.currentTarget.valueAsNumber)} style={{ flex: 1 }} />
            <span style={{ width: "60px", "text-align": "right", "font-size": "12px" }}>{revealTravel()}px</span>
          </label>
        </div>

        {/* debug info */}
        <div style={{ "font-size": "11px", color: "var(--color-text-weak, #888)", "font-family": "monospace" }}>
          text: {text() ?? "(none)"} · growOnly: {growOnly() ? "on" : "off"}
        </div>
      </div>
    )
  },
}
