import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Show, type JSX } from "solid-js"
import type { TimelineGap } from "./spacing"

/**
 * The lane below a working turn: the status line, and any action beside it. It keeps its height while empty, so the
 * status coming and going does not move the rows around it, and collapses where the thought the model is writing takes
 * its place.
 */
export function StatusLane(props: {
  label?: string
  collapsed?: boolean
  /** The space above the next row of the turn, so the line sits where that row will. */
  spacing?: TimelineGap
  /** The lane sits in a row of the timeline, which clips what reaches past it, rather than in its open tail. */
  inRow?: boolean
  class?: string
  children?: JSX.Element
}) {
  return (
    <div
      data-timeline="next"
      data-component="timeline-status-lane"
      data-collapsed={props.collapsed ? "" : undefined}
      data-spacing={props.spacing}
      data-in-row={props.inRow ? "" : undefined}
      class={props.class}
    >
      <Show when={props.label}>
        {(label) => (
          <div data-component="session-working" role="status" aria-label={label()}>
            <span data-slot="timeline-status-label">
              <TextShimmer text={label()} active />
            </span>
          </div>
        )}
      </Show>
      {props.children}
    </div>
  )
}
