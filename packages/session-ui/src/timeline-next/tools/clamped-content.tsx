import { createEffect, createSignal, on, onCleanup, onMount, type JSX } from "solid-js"

/**
 * Output cut to its last few lines, as a command the user ran shows it, so the newest stay in view as running output
 * grows. Its owner offers the control that shows the rest, so the text stays selectable.
 */
export function ClampedContent(props: {
  expanded: boolean
  /** Whether the content is longer than the cut, so the owner knows to offer its toggle. */
  onOverflowChange?: (overflow: boolean) => void
  children: JSX.Element
}) {
  const [overflow, setOverflow] = createSignal(false)
  let frame: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined

  const measure = () => {
    if (!frame || !content) return
    // Measured against the cut height, so an expanded frame still knows whether it has more than the cut shows.
    const limit = Number.parseFloat(getComputedStyle(frame).getPropertyValue("--clamped-content-height")) || 96
    setOverflow(content.offsetHeight > limit + 1)

    // Shifting the content rather than scrolling it keeps the fade over the frame's edge.
    const shift = props.expanded ? 0 : Math.min(0, frame.clientHeight - content.offsetHeight)

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

  return (
    <div
      ref={frame}
      data-component="clamped-content"
      data-clamped={props.expanded ? undefined : ""}
      data-overflow={!props.expanded && overflow() ? "" : undefined}
    >
      <div ref={content}>{props.children}</div>
    </div>
  )
}
