// @ts-nocheck
import { createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { BasicTool } from "./basic-tool"
import { animate } from "motion"

export default {
  title: "UI/Shell Submessage Motion",
  id: "components-shell-submessage-motion",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: `### Overview
Interactive playground for animating the Shell tool subtitle ("submessage") in the timeline trigger row.

### Production component path
- Trigger layout: \`packages/ui/src/components/basic-tool.tsx\`
- Bash tool subtitle source: \`packages/ui/src/components/message-part.tsx\` (tool: \`bash\`, \`trigger.subtitle\`)

### What this playground tunes
- Width reveal (spring-driven pixel width via \`useSpring\`)
- Opacity fade
- Blur settle`,
      },
    },
  },
}

const btn = (accent?: boolean) =>
  ({
    padding: "6px 14px",
    "border-radius": "6px",
    border: "1px solid var(--color-divider, #333)",
    background: accent ? "var(--color-accent, #58f)" : "var(--color-fill-element, #222)",
    color: "var(--color-text, #eee)",
    cursor: "pointer",
    "font-size": "13px",
  }) as const

const sliderLabel = {
  "font-size": "11px",
  "font-family": "monospace",
  color: "var(--color-text-weak, #666)",
  "min-width": "84px",
  "flex-shrink": "0",
  "text-align": "right",
}

const sliderValue = {
  "font-family": "monospace",
  "font-size": "11px",
  color: "var(--color-text-weak, #aaa)",
  "min-width": "76px",
}

const shellCss = `
[data-component="shell-submessage-scene"] [data-component="tool-trigger"] [data-slot="basic-tool-tool-info-main"] {
  align-items: baseline;
}

[data-component="shell-submessage"] {
  min-width: 0;
  max-width: 100%;
  display: inline-flex;
  align-items: baseline;
  vertical-align: baseline;
}

[data-component="shell-submessage"] [data-slot="shell-submessage-width"] {
  min-width: 0;
  max-width: 100%;
  display: inline-flex;
  align-items: baseline;
  overflow: hidden;
}

[data-component="shell-submessage"] [data-slot="shell-submessage-value"] {
  display: inline-block;
  vertical-align: baseline;
  min-width: 0;
  line-height: inherit;
  white-space: nowrap;
  opacity: 0;
  filter: blur(var(--shell-sub-blur, 2px));
  transition-property: opacity, filter;
  transition-duration: var(--shell-sub-fade-ms, 320ms);
  transition-timing-function: var(--shell-sub-fade-ease, cubic-bezier(0.22, 1, 0.36, 1));
}

[data-component="shell-submessage"][data-visible] [data-slot="shell-submessage-value"] {
  opacity: 1;
  filter: blur(0px);
}
`

const ease = {
  smooth: "cubic-bezier(0.16, 1, 0.3, 1)",
  snappy: "cubic-bezier(0.22, 1, 0.36, 1)",
  standard: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  linear: "linear",
}

function SpringSubmessage(props: { text: string; visible: boolean; visualDuration: number; bounce: number }) {
  let ref: HTMLSpanElement | undefined
  let widthRef: HTMLSpanElement | undefined

  createEffect(() => {
    if (!widthRef) return
    if (props.visible) {
      requestAnimationFrame(() => {
        ref?.setAttribute("data-visible", "")
        animate(
          widthRef!,
          { width: "auto" },
          { type: "spring", visualDuration: props.visualDuration, bounce: props.bounce },
        )
      })
    } else {
      ref?.removeAttribute("data-visible")
      animate(
        widthRef,
        { width: "0px" },
        { type: "spring", visualDuration: props.visualDuration, bounce: props.bounce },
      )
    }
  })

  return (
    <span ref={ref} data-component="shell-submessage">
      <span ref={widthRef} data-slot="shell-submessage-width" style={{ width: "0px" }}>
        <span data-slot="basic-tool-tool-subtitle">
          <span data-slot="shell-submessage-value">{props.text || "\u00A0"}</span>
        </span>
      </span>
    </span>
  )
}

export const Playground = {
  render: () => {
    const [state, setState] = createStore({
      text: "Prints five topic blocks between timed commands",
      show: true,
      visualDuration: 0.35,
      bounce: 0,
      fadeMs: 320,
      blur: 2,
      fadeEase: "snappy",
      auto: false,
    })
    const text = () => state.text
    const show = () => state.show
    const visualDuration = () => state.visualDuration
    const bounce = () => state.bounce
    const fadeMs = () => state.fadeMs
    const blur = () => state.blur
    const fadeEase = () => state.fadeEase
    const auto = () => state.auto
    let replayTimer
    let autoTimer

    const replay = () => {
      setState("show", false)
      if (replayTimer) clearTimeout(replayTimer)
      replayTimer = setTimeout(() => {
        setState("show", true)
      }, 50)
    }

    const stopAuto = () => {
      if (autoTimer) clearInterval(autoTimer)
      autoTimer = undefined
      setState("auto", false)
    }

    const toggleAuto = () => {
      if (auto()) {
        stopAuto()
        return
      }
      setState("auto", true)
      autoTimer = setInterval(replay, 2200)
    }

    onCleanup(() => {
      if (replayTimer) clearTimeout(replayTimer)
      if (autoTimer) clearInterval(autoTimer)
    })

    return (
      <div
        data-component="shell-submessage-scene"
        style={{
          display: "grid",
          gap: "20px",
          padding: "20px",
          "max-width": "860px",
          "--shell-sub-fade-ms": `${fadeMs()}ms`,
          "--shell-sub-blur": `${blur()}px`,
          "--shell-sub-fade-ease": ease[fadeEase()],
        }}
      >
        <style>{shellCss}</style>

        <BasicTool
          icon="console"
          defaultOpen
          trigger={
            <div data-slot="basic-tool-tool-info-structured">
              <div data-slot="basic-tool-tool-info-main">
                <span data-slot="basic-tool-tool-title">Shell</span>
                <SpringSubmessage text={text()} visible={show()} visualDuration={visualDuration()} bounce={bounce()} />
              </div>
            </div>
          }
        >
          <div
            style={{
              "border-radius": "8px",
              border: "1px solid var(--color-divider, #333)",
              background: "var(--color-fill-secondary, #161616)",
              padding: "14px 16px",
              "font-family": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              "font-size": "18px",
              color: "var(--color-text, #eee)",
              "white-space": "pre-wrap",
            }}
          >
            {"$ cat <<'TOPIC1'"}
          </div>
        </BasicTool>

        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
          <button onClick={replay} style={btn()}>
            Replay entry
          </button>
          <button onClick={() => setState("show", (value) => !value)} style={btn(show())}>
            {show() ? "Hide subtitle" : "Show subtitle"}
          </button>
          <button onClick={toggleAuto} style={btn(auto())}>
            {auto() ? "Stop auto replay" : "Auto replay"}
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gap: "10px",
            "border-top": "1px solid var(--color-divider, #333)",
            "padding-top": "14px",
          }}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>subtitle</span>
            <input
              value={text()}
              onInput={(e) => setState("text", e.currentTarget.value)}
              style={{
                width: "420px",
                "max-width": "100%",
                padding: "6px 8px",
                "border-radius": "6px",
                border: "1px solid var(--color-divider, #333)",
                background: "var(--color-fill-element, #222)",
                color: "var(--color-text, #eee)",
              }}
            />
          </div>

          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>visualDuration</span>
            <input
              type="range"
              min={0.05}
              max={1.5}
              step={0.01}
              value={visualDuration()}
              onInput={(e) => setState("visualDuration", Number(e.currentTarget.value))}
            />
            <span style={sliderValue}>{visualDuration().toFixed(2)}s</span>
          </div>

          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>bounce</span>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.01}
              value={bounce()}
              onInput={(e) => setState("bounce", Number(e.currentTarget.value))}
            />
            <span style={sliderValue}>{bounce().toFixed(2)}</span>
          </div>

          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>fade ease</span>
            <button
              onClick={() =>
                setState("fadeEase", (value) =>
                  value === "snappy"
                    ? "smooth"
                    : value === "smooth"
                      ? "standard"
                      : value === "standard"
                        ? "linear"
                        : "snappy",
                )
              }
              style={btn()}
            >
              {fadeEase()}
            </button>
          </div>

          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>fade</span>
            <input
              type="range"
              min={0}
              max={1400}
              step={10}
              value={fadeMs()}
              onInput={(e) => setState("fadeMs", Number(e.currentTarget.value))}
            />
            <span style={sliderValue}>{fadeMs()}ms</span>
          </div>

          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={sliderLabel}>blur</span>
            <input
              type="range"
              min={0}
              max={14}
              step={0.5}
              value={blur()}
              onInput={(e) => setState("blur", Number(e.currentTarget.value))}
            />
            <span style={sliderValue}>{blur()}px</span>
          </div>
        </div>
      </div>
    )
  },
}
