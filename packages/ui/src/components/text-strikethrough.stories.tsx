// @ts-nocheck
import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { useSpring } from "./motion-spring"
import { TextStrikethrough } from "./text-strikethrough"

const TEXT_SHORT = "Remove inline measure nodes"
const TEXT_MED = "Remove inline measure nodes and keep width morph behavior intact"
const TEXT_LONG =
  "Refactor ToolStatusTitle DOM measurement to offscreen global measurer (unconstrained by timeline layout)"

const btn = (active?: boolean) =>
  ({
    padding: "8px 18px",
    "border-radius": "6px",
    border: "1px solid var(--color-divider, #444)",
    background: active ? "var(--color-accent, #58f)" : "var(--color-fill-element, #222)",
    color: "var(--color-text, #eee)",
    cursor: "pointer",
    "font-size": "14px",
    "font-weight": "500",
  }) as const

const heading = {
  "font-size": "11px",
  "font-weight": "600",
  "text-transform": "uppercase" as const,
  "letter-spacing": "0.05em",
  color: "var(--text-weak, #888)",
  "margin-bottom": "4px",
}

const card = {
  padding: "16px 20px",
  "border-radius": "10px",
  border: "1px solid var(--border-weak-base, #333)",
  background: "var(--surface-base, #1a1a1a)",
}

/* ─── Variant A: scaleX pseudo-line at 50% ─── */
function VariantA(props: { active: boolean; text: string }) {
  const progress = useSpring(
    () => (props.active ? 1 : 0),
    () => ({ visualDuration: 0.35, bounce: 0 }),
  )
  return (
    <span
      style={{
        position: "relative",
        display: "block",
        color: props.active ? "var(--text-weak, #888)" : "var(--text-strong, #eee)",
        transition: "color 220ms ease",
      }}
    >
      {props.text}
      <span
        style={{
          position: "absolute",
          left: "0",
          right: "0",
          top: "50%",
          height: "1.5px",
          background: "currentColor",
          "transform-origin": "left center",
          transform: `scaleX(${progress()})`,
          "pointer-events": "none",
        }}
      />
    </span>
  )
}

/* ─── Variant D: background-image line ─── */
function VariantD(props: { active: boolean; text: string }) {
  const progress = useSpring(
    () => (props.active ? 1 : 0),
    () => ({ visualDuration: 0.35, bounce: 0 }),
  )
  return (
    <span
      style={{
        display: "block",
        color: props.active ? "var(--text-weak, #888)" : "var(--text-strong, #eee)",
        transition: "color 220ms ease",
        "background-image": "linear-gradient(currentColor, currentColor)",
        "background-repeat": "no-repeat",
        "background-size": `${progress() * 100}% 1.5px`,
        "background-position": "left center",
      }}
    >
      {props.text}
    </span>
  )
}

/* ─── Variant E: grid stacking + clip-path (container %) ─── */
function VariantE(props: { active: boolean; text: string }) {
  const progress = useSpring(
    () => (props.active ? 1 : 0),
    () => ({ visualDuration: 0.35, bounce: 0 }),
  )
  return (
    <span
      style={{
        display: "grid",
        color: props.active ? "var(--text-weak, #888)" : "var(--text-strong, #eee)",
        transition: "color 220ms ease",
      }}
    >
      <span style={{ "grid-area": "1 / 1" }}>{props.text}</span>
      <span
        aria-hidden="true"
        style={{
          "grid-area": "1 / 1",
          "text-decoration": "line-through",
          "pointer-events": "none",
          "clip-path": `inset(0 ${(1 - progress()) * 100}% 0 0)`,
        }}
      >
        {props.text}
      </span>
    </span>
  )
}

/* ─── Variant F: grid stacking + clip-path mapped to text width ─── */
function VariantF(props: { active: boolean; text: string }) {
  const progress = useSpring(
    () => (props.active ? 1 : 0),
    () => ({ visualDuration: 0.35, bounce: 0 }),
  )
  let baseRef: HTMLSpanElement | undefined
  let containerRef: HTMLSpanElement | undefined
  const [textWidth, setTextWidth] = createSignal(0)
  const [containerWidth, setContainerWidth] = createSignal(0)

  const measure = () => {
    if (baseRef) setTextWidth(baseRef.scrollWidth)
    if (containerRef) setContainerWidth(containerRef.offsetWidth)
  }

  onMount(measure)
  createEffect(() => {
    const el = containerRef
    if (!el) return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  })

  const clipRight = () => {
    const cw = containerWidth()
    const tw = textWidth()
    if (cw <= 0 || tw <= 0) return `${(1 - progress()) * 100}%`
    const revealed = progress() * tw
    const remaining = Math.max(0, cw - revealed)
    return `${remaining}px`
  }

  return (
    <span
      ref={containerRef}
      style={{
        display: "grid",
        color: props.active ? "var(--text-weak, #888)" : "var(--text-strong, #eee)",
        transition: "color 220ms ease",
      }}
    >
      <span ref={baseRef} style={{ "grid-area": "1 / 1" }}>
        {props.text}
      </span>
      <span
        aria-hidden="true"
        style={{
          "grid-area": "1 / 1",
          "text-decoration": "line-through",
          "pointer-events": "none",
          "clip-path": `inset(0 ${clipRight()} 0 0)`,
        }}
      >
        {props.text}
      </span>
    </span>
  )
}

export default {
  title: "UI/Text Strikethrough",
  id: "components-text-strikethrough",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: `### Animated Strikethrough Variants

- **A** — scaleX line at 50% (single line only)
- **D** — background-image line (single line only)
- **E** — grid stacking + clip-path (container %)
- **F** — grid stacking + clip-path mapped to text width (the real component)`,
      },
    },
  },
}

export const Playground = {
  render: () => {
    const [active, setActive] = createSignal(false)
    const toggle = () => setActive((v) => !v)

    return (
      <div style={{ display: "grid", gap: "24px", padding: "24px", "max-width": "700px" }}>
        <button onClick={toggle} style={btn(active())}>
          {active() ? "Undo strikethrough" : "Strike through all"}
        </button>

        <div style={card}>
          <div style={heading}>F — grid stacking + clip mapped to text width (THE COMPONENT)</div>
          <TextStrikethrough
            active={active()}
            text={TEXT_SHORT}
            style={{
              color: active() ? "var(--text-weak, #888)" : "var(--text-strong, #eee)",
              transition: "color 220ms ease",
            }}
          />
          <div style={{ "margin-top": "12px" }} />
          <TextStrikethrough
            active={active()}
            text={TEXT_MED}
            style={{
              color: active() ? "var(--text-weak, #888)" : "var(--text-strong, #eee)",
              transition: "color 220ms ease",
            }}
          />
          <div style={{ "margin-top": "12px" }} />
          <TextStrikethrough
            active={active()}
            text={TEXT_LONG}
            style={{
              color: active() ? "var(--text-weak, #888)" : "var(--text-strong, #eee)",
              transition: "color 220ms ease",
            }}
          />
        </div>

        <div style={card}>
          <div style={heading}>F (inline) — same but just inline variants</div>
          <VariantF active={active()} text={TEXT_SHORT} />
          <div style={{ "margin-top": "12px" }} />
          <VariantF active={active()} text={TEXT_MED} />
          <div style={{ "margin-top": "12px" }} />
          <VariantF active={active()} text={TEXT_LONG} />
        </div>

        <div style={card}>
          <div style={heading}>E — grid stacking + clip-path (container %)</div>
          <VariantE active={active()} text={TEXT_SHORT} />
          <div style={{ "margin-top": "12px" }} />
          <VariantE active={active()} text={TEXT_MED} />
          <div style={{ "margin-top": "12px" }} />
          <VariantE active={active()} text={TEXT_LONG} />
        </div>

        <div style={card}>
          <div style={heading}>A — scaleX line at 50%</div>
          <VariantA active={active()} text={TEXT_SHORT} />
          <div style={{ "margin-top": "12px" }} />
          <VariantA active={active()} text={TEXT_LONG} />
        </div>

        <div style={card}>
          <div style={heading}>D — background-image line</div>
          <VariantD active={active()} text={TEXT_SHORT} />
          <div style={{ "margin-top": "12px" }} />
          <VariantD active={active()} text={TEXT_LONG} />
        </div>
      </div>
    )
  },
}
