import { useI18n } from "@opencode/ui/context/i18n"
import { createEffect, createSignal, on, onCleanup, onMount, type JSX } from "solid-js"

/**
 * Content cut to a few lines, as the New timeline shows shell output and diffs. Its owner offers the control that shows
 * the rest, so the text stays selectable. `tail` keeps the newest lines in view, as running output grows.
 */
export function ClampedContent(props: {
  expanded: boolean
  tail?: boolean
  /** The height to cut at, measured from the rendered content, in place of the fixed one. */
  height?: (content: HTMLElement) => number | undefined
  /** Whether the content is longer than the cut, so the owner knows to offer its toggle. */
  onOverflowChange?: (overflow: boolean) => void
  /** Makes the cut content itself the control that shows the rest. */
  onExpand?: () => void
  children: JSX.Element
}) {
  const i18n = useI18n()
  const [overflow, setOverflow] = createSignal(false)
  let frame: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined

  const measure = () => {
    if (!frame || !content) return
    const height = props.height?.(content)

    frame.style.setProperty("--clamped-content-height", height ? `${height}px` : null)
    // Measured against the cut height, so an expanded frame still knows whether it has more than the cut shows.
    const limit = Number.parseFloat(getComputedStyle(frame).getPropertyValue("--clamped-content-height")) || 96
    setOverflow(content.offsetHeight > limit + 1)

    // Shifting the content rather than scrolling it keeps the fade over the frame's edge.
    const shift = props.tail && !props.expanded ? Math.min(0, frame.clientHeight - content.offsetHeight) : 0

    content.style.translate = shift ? `0 ${shift}px` : ""
  }

  onMount(() => {
    const observer = new ResizeObserver(measure)

    if (frame) observer.observe(frame)

    if (content) observer.observe(content)
    onCleanup(() => observer.disconnect())
  })

  createEffect(on(() => props.expanded, measure, { defer: true }))
  createEffect(on(overflow, (value) => props.onOverflowChange?.(value)))

  const expandable = () => !!props.onExpand && !props.expanded && overflow()

  return (
    <div
      ref={frame}
      data-component="clamped-content"
      data-clamped={props.expanded ? undefined : ""}
      data-overflow={!props.expanded && overflow() ? "" : undefined}
      data-tail={props.tail ? "" : undefined}
      data-expandable={expandable() ? "" : undefined}
      role={expandable() ? "button" : undefined}
      tabIndex={expandable() ? 0 : undefined}
      aria-label={expandable() ? i18n.t("ui.common.showMore") : undefined}
      onClick={() => {
        if (expandable()) props.onExpand?.()
      }}
      onKeyDown={(event) => {
        if (!expandable() || (event.key !== "Enter" && event.key !== " ")) return
        event.preventDefault()
        props.onExpand?.()
      }}
    >
      <div ref={content}>{props.children}</div>
    </div>
  )
}
