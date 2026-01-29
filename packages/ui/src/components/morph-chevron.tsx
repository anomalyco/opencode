import { createEffect, createUniqueId, on } from "solid-js"

export interface MorphChevronProps {
  expanded: boolean
  class?: string
}

const COLLAPSED = "M4 6L8 10L12 6"
const EXPANDED = "M4 10L8 6L12 10"

export function MorphChevron(props: MorphChevronProps) {
  const id = createUniqueId()
  let path: SVGPathElement | undefined
  let expandAnim: SVGAnimateElement | undefined
  let collapseAnim: SVGAnimateElement | undefined

  createEffect(
    on(
      () => props.expanded,
      (expanded, prev) => {
        if (prev === undefined) {
          // Set initial state without animation
          path?.setAttribute("d", expanded ? EXPANDED : COLLAPSED)
          return
        }
        if (expanded) {
          expandAnim?.beginElement()
        } else {
          collapseAnim?.beginElement()
        }
      },
    ),
  )

  return (
    <svg
      viewBox="0 0 16 16"
      data-slot="morph-chevron-svg"
      class={props.class}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path ref={path} d={COLLAPSED} id={`morph-chevron-path-${id}`}>
        <animate
          ref={(el) => {
            expandAnim = el
          }}
          id={`morph-expand-${id}`}
          attributeName="d"
          dur="200ms"
          fill="freeze"
          calcMode="spline"
          keySplines="0.25 0 0.5 1"
          values="M4 6L8 10L12 6;M4 10L8 6L12 10"
          begin="indefinite"
        />
        <animate
          ref={(el) => {
            collapseAnim = el
          }}
          id={`morph-collapse-${id}`}
          attributeName="d"
          dur="200ms"
          fill="freeze"
          calcMode="spline"
          keySplines="0.25 0 0.5 1"
          values="M4 10L8 6L12 10;M4 6L8 10L12 6"
          begin="indefinite"
        />
      </path>
    </svg>
  )
}
