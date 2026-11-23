import { splitProps, type ComponentProps, type JSX } from "solid-js"

// Every AI activity spinner (busy session tabs, the activity chip, subagents, tool cards) shows Soft Radar. Non-AI
// loading uses Loader.

/**
 * Soft Radar, painted by one element through a CSS mask whose frames are a pre-rendered APNG (spinner-frames.css).
 * `width` and `height` size it like an SVG's attributes, below any CSS size.
 *
 * Keep every spinner to one element with no CSS animation, whatever the design. Lists show many at once (20 subagent
 * rows, busy tabs, sidebar rows). The APNG advances on its own, every spinner showing it shares one loop (so they stay in
 * phase with no script), and nothing restyles on a main-thread frame. A per-dot spinner costs 24 animations and 25 nodes
 * each, which Blink restyles every frame and restarts on every remount: that took the background activity menu below
 * 1 FPS with 20 subagents (#65634). This is the third time the cost has been removed: a baked APNG (#42952) was
 * replaced by per-dot CSS when a new design shipped (#58010, #58578, #61562), then by one mask strip (#65634).
 *
 * To change the look, change the dots in `spinner-radar.ts` and run `bun run generate:spinner` in packages/ui. The
 * frames come from those dots, and `spinner-radar.test.ts` fails if the committed frames no longer match them.
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

  return (
    <span
      {...rest}
      data-component={local["data-component"] ?? "spinner"}
      data-slot="spinner-dots"
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
      style={{
        ...local.style,
        "--spinner-width": local.width === undefined ? undefined : `${local.width}px`,
        "--spinner-height": local.height === undefined ? undefined : `${local.height}px`,
      }}
    />
  )
}
