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
 *
 * Keep every spinner to one element and one animation, whatever the design. Lists show many at once (20 subagent rows,
 * busy tabs, sidebar rows), and a per-dot spinner costs 24 animations and 25 nodes each: Blink restyles all of them on
 * every main-thread frame, and remounting a row restarts 24 `animationstart` events. That took the background activity
 * menu below 1 FPS with 20 subagents (#65634). The same cost was removed once before with a baked APNG (#42952) and
 * came back when a new design shipped as per-dot CSS (#58010, #58578, #61562). To change the look, change the dots in
 * `spinner-radar.ts`: the strip is generated from them, so the design and the mask can't drift apart.
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
