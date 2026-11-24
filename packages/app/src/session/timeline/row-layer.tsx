import { children, createRenderEffect, type JSX } from "solid-js"
import { placeRows } from "./place-rows"

/** The element that holds the timeline's mounted rows. It places them itself: see `placeRows`. */
export function RowLayer(props: {
  ref: (element: HTMLDivElement) => void
  class: string
  style: JSX.CSSProperties
  children: JSX.Element
}) {
  const rows = children(() => props.children)

  return (
    <div
      ref={(element) => {
        props.ref(element)
        createRenderEffect(() =>
          placeRows(
            element,
            rows.toArray().filter((row) => row instanceof Node),
          ),
        )
      }}
      class={props.class}
      style={props.style}
    />
  )
}
