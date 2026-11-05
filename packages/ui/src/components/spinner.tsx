import { For, splitProps, type ComponentProps, type JSX } from "solid-js"
import { syncSpinPhase } from "../hooks/spin-phase"
import { radarDots, radarKeyframes, radarLoop } from "./spinner-radar"

// Every AI activity spinner (busy session tabs, the activity chip, subagents, tool cards) shows Soft Radar. Non-AI
// loading uses Loader.

const keyframes = "spinner-radar"

const dots = radarDots()

// The keyframes are added to the document once, the first time a spinner renders.
let added = false

/**
 * Each dot is its own SVG over the whole box, drawn exactly where it sat in one SVG. The compositor runs the opacity
 * animation of an SVG element but not of a shape inside one, so a spinner no longer restyles and repaints on every
 * frame. `width` and `height` size it like an SVG's attributes, below any CSS size.
 */
export function Spinner(
  props: Omit<ComponentProps<"span">, "style"> & {
    "data-component"?: string
    width?: number
    height?: number
    style?: JSX.CSSProperties
  },
) {
  const [local, rest] = splitProps(props, ["class", "classList", "data-component", "width", "height", "style"])

  if (!added) {
    added = true
    const style = document.createElement("style")
    style.textContent = radarKeyframes(keyframes)
    document.head.append(style)
  }

  return (
    <span
      {...rest}
      ref={syncSpinPhase}
      data-component={local["data-component"] ?? "spinner"}
      data-slot="spinner-dots"
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
      style={{
        ...local.style,
        "--spinner-width": local.width === undefined ? undefined : `${local.width}px`,
        "--spinner-height": local.height === undefined ? undefined : `${local.height}px`,
      }}
    >
      <For each={dots}>
        {(dot) => (
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            style={{
              "--still": dot.still,
              animation: dot.steady
                ? undefined
                : `${keyframes}-${dot.shape} calc(${radarLoop}s * var(--spinner-time, 1)) linear calc(${-radarLoop * (1 - dot.at)}s * var(--spinner-time, 1)) infinite`,
            }}
          >
            <rect x={dot.x} y={dot.y} width={dot.size} height={dot.size} rx={dot.size * 0.24} />
          </svg>
        )}
      </For>
    </span>
  )
}
