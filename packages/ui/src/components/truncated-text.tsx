import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createEffect, on } from "solid-js"
import { createStore } from "solid-js/store"
import { Tooltip } from "@opencode/ui/tooltip"
import "./truncated-text.css"

/** Reveals an ellipsized name on hover or focus; touch layouts wrap the complete name instead. */
export function TruncatedText(props: { text: string; class?: string }) {
  let label: HTMLSpanElement | undefined
  const [store, setStore] = createStore({ truncated: false })
  const measure = () => setStore("truncated", !!label && label.scrollWidth > label.clientWidth)

  createResizeObserver(() => label, measure)
  createEffect(on(() => props.text, measure))

  return (
    <Tooltip
      value={<span dir="auto">{props.text}</span>}
      disabled={!store.truncated}
      triggerTabIndex={store.truncated ? 0 : -1}
      class={`truncated-text ${props.class ?? ""}`}
      contentClass="truncated-text-tooltip"
    >
      <span ref={label} dir="auto" data-slot="truncated-text-label">
        {props.text}
      </span>
    </Tooltip>
  )
}
