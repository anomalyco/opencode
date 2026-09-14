import { createSignal, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"

const DIVIDER = "1px solid rgba(255,255,255,.08)"

export default function SplitPane(props: {
  table: JSX.Element
  detail: JSX.Element
  selected: boolean
}): JSX.Element {
  const [narrow, setNarrow] = createSignal(
    typeof window !== "undefined" ? window.matchMedia("(max-width: 900px)").matches : false,
  )

  if (typeof window !== "undefined") {
    const query = window.matchMedia("(max-width: 900px)")
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches)
    query.addEventListener("change", onChange)
    onCleanup(() => query.removeEventListener("change", onChange))
  }

  const overlay = () => props.selected && narrow()

  return (
    <div style={{ position: "relative", display: "flex", "flex-direction": "row", width: "100%", height: "100%", "min-height": "0", overflow: "hidden" }}>
      <div style={{ flex: props.selected && !narrow() ? "0 0 340px" : "1 1 auto", "min-width": "0", "min-height": "0", display: "flex", "flex-direction": "column", overflow: "hidden" }}>
        {props.table}
      </div>
      <Show when={props.selected && !overlay()}>
        <div style={{ width: "1px", "align-self": "stretch", background: "rgba(255,255,255,.08)" }} />
        <div style={{ flex: "1 1 auto", "min-width": "480px", "min-height": "0", display: "flex", "flex-direction": "column", overflow: "hidden" }}>{props.detail}</div>
      </Show>
      <Show when={overlay()}>
        <div style={{ position: "absolute", inset: "0", background: "rgba(0,0,0,.5)", "z-index": "10" }} onClick={() => { /* overlay backdrop; selection cleared by page */ }} />
        <div style={{ position: "absolute", top: "0", right: "0", bottom: "0", width: "min(560px,100%)", background: "var(--background-base, #101012)", "z-index": "11", overflow: "auto", "border-left": DIVIDER, display: "flex", "flex-direction": "column" }}>
          {props.detail}
        </div>
      </Show>
    </div>
  )
}
