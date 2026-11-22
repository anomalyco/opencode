import { splitProps, type ComponentProps, type JSX } from "solid-js"
import { syncSpinPhase } from "../hooks/spin-phase"
import { radarStylesheet } from "./spinner-radar"

// Every AI activity spinner (busy session tabs, the activity chip, subagents, tool cards) shows Soft Radar. Non-AI
// loading uses Loader.

const keyframes = "spinner-radar"

// The sprite mask and keyframes are added to the document once, the first time a spinner renders.
let added = false

/**
 * Renders Soft Radar from one vertical SVG mask strip stepped with a single composited transform animation.
 * `width` and `height` size it like an SVG's attributes, below any CSS size.
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
    style.textContent = radarStylesheet(keyframes)
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
      <span data-slot="spinner-strip" />
    </span>
  )
}
