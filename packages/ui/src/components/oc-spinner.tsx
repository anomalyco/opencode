import { ComponentProps } from "solid-js"
import "./oc-spinner.css"

export function OCSpinner(props: Readonly<{
  class?: string
  classList?: ComponentProps<"svg">["classList"]
  style?: ComponentProps<"svg">["style"]
}>) {

  return (
    <svg
      {...props}
      // TODO: If glow effect is reintroduced, change viewBox back to "-3 -6 22 32" to accommodate the glow padding
      viewBox="-2 0 20 20"
      data-component="oc-spinner"
      classList={{
        ...props.classList,
        [props.class ?? ""]: !!props.class,
      }}
      fill="currentColor"
      style={props.style}
    >

      {/* Layer 1: Static perimeter base */}
      <path
        d="M 0 0 L 16 0 L 16 20 L 0 20 Z M 4 4 L 4 16 L 12 16 L 12 4 Z"
        fill-rule="evenodd"
        opacity="0.65"
      />

      {/* Layer 1b: Inner background (perimeterBG) - only bottom area */}
      <rect
        x="4"
        y="8"
        width="8"
        height="8"
        fill="currentColor"
        opacity="0.15"
      />

      {/* Layer 2: Animated trail with motion blur on both ends (12 segments) */}
      <path d="M 2 2 L 14 2 L 14 18 L 2 18 Z" stroke="currentColor" stroke-width="4" stroke-linecap="square" fill="none" opacity="0.25" style={{ animation: `oc-trail-move 1s linear infinite`, "stroke-dasharray": "4 52", "animation-delay": "0.16s" }} />
      <path d="M 2 2 L 14 2 L 14 18 L 2 18 Z" stroke="currentColor" stroke-width="4" stroke-linecap="square" fill="none" opacity="0.4" style={{ animation: `oc-trail-move 1s linear infinite`, "stroke-dasharray": "4 52", "animation-delay": "0.128s" }} />
      <path d="M 2 2 L 14 2 L 14 18 L 2 18 Z" stroke="currentColor" stroke-width="4" stroke-linecap="square" fill="none" opacity="0.55" style={{ animation: `oc-trail-move 1s linear infinite`, "stroke-dasharray": "4 52", "animation-delay": "0.096s" }} />
      <path d="M 2 2 L 14 2 L 14 18 L 2 18 Z" stroke="currentColor" stroke-width="4" stroke-linecap="square" fill="none" opacity="0.7" style={{ animation: `oc-trail-move 1s linear infinite`, "stroke-dasharray": "4 52", "animation-delay": "0.064s" }} />
      <path d="M 2 2 L 14 2 L 14 18 L 2 18 Z" stroke="currentColor" stroke-width="4" stroke-linecap="square" fill="none" opacity="0.85" style={{ animation: `oc-trail-move 1s linear infinite`, "stroke-dasharray": "4 52", "animation-delay": "0.032s" }} />
      <path d="M 2 2 L 14 2 L 14 18 L 2 18 Z" stroke="currentColor" stroke-width="4" stroke-linecap="square" fill="none" opacity="1" style={{ animation: `oc-trail-move 1s linear infinite`, "stroke-dasharray": "4 52", "animation-delay": "0s" }} />
      <path d="M 2 2 L 14 2 L 14 18 L 2 18 Z" stroke="currentColor" stroke-width="4" stroke-linecap="square" fill="none" opacity="0.85" style={{ animation: `oc-trail-move 1s linear infinite`, "stroke-dasharray": "4 52", "animation-delay": "-0.032s" }} />
      <path d="M 2 2 L 14 2 L 14 18 L 2 18 Z" stroke="currentColor" stroke-width="4" stroke-linecap="square" fill="none" opacity="0.7" style={{ animation: `oc-trail-move 1s linear infinite`, "stroke-dasharray": "4 52", "animation-delay": "-0.064s" }} />
      <path d="M 2 2 L 14 2 L 14 18 L 2 18 Z" stroke="currentColor" stroke-width="4" stroke-linecap="square" fill="none" opacity="0.55" style={{ animation: `oc-trail-move 1s linear infinite`, "stroke-dasharray": "4 52", "animation-delay": "-0.096s" }} />
      <path d="M 2 2 L 14 2 L 14 18 L 2 18 Z" stroke="currentColor" stroke-width="4" stroke-linecap="square" fill="none" opacity="0.4" style={{ animation: `oc-trail-move 1s linear infinite`, "stroke-dasharray": "4 52", "animation-delay": "-0.128s" }} />
      <path d="M 2 2 L 14 2 L 14 18 L 2 18 Z" stroke="currentColor" stroke-width="4" stroke-linecap="square" fill="none" opacity="0.25" style={{ animation: `oc-trail-move 1s linear infinite`, "stroke-dasharray": "4 52", "animation-delay": "-0.16s" }} />

      <style>{`
        @keyframes oc-trail-move {
          0% {
            stroke-dashoffset: 0;
          }
          100% {
            stroke-dashoffset: -56;
          }
        }
      `}</style>
    </svg>
  )
}
