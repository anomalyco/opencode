import {
  INITIAL_HOVER_COMMENT_STATE,
  selectHoverActive,
  selectHoverLine,
  transitionHoverComment,
  type HoverCommentEvent,
  type HoverCommentLine,
  type HoverCommentSync,
} from "./comment-hover-machine"

export type { HoverCommentLine }

/** A gutter `+` button and the hover tracking behind it. Dispose it when its viewer stops rendering it. */
export type HoverComment = {
  button: HTMLButtonElement
  dispose: () => void
  /** Whether the next render may return this button instead of building another. */
  canReuse: () => boolean
}

export function createHoverComment(props: {
  label: string
  getHoveredLine: () => HoverCommentLine | undefined
  onSelect: (line: HoverCommentLine) => void
  /** Whether the line is in the selected range, which a click comments on as a whole rather than starting a new one. */
  isSelected: (line: HoverCommentLine) => boolean
}): HoverComment | undefined {
  if (typeof document === "undefined") return

  const button = document.createElement("button")
  button.type = "button"
  button.ariaLabel = props.label
  // A drawn plus, unlike a "+" glyph, is centered regardless of the font's metrics.
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  icon.setAttribute("width", "12")
  icon.setAttribute("height", "12")
  icon.setAttribute("viewBox", "0 0 12 12")
  icon.setAttribute("fill", "none")
  icon.setAttribute("aria-hidden", "true")
  const plus = document.createElementNS("http://www.w3.org/2000/svg", "path")
  plus.setAttribute("d", "M6 2V10M2 6H10")
  plus.setAttribute("stroke", "currentColor")
  plus.setAttribute("stroke-width", "1.5")
  icon.append(plus)
  button.append(icon)
  button.style.width = "20px"
  button.style.height = "20px"
  button.style.display = "flex"
  button.style.alignItems = "center"
  button.style.justifyContent = "center"
  button.style.border = "none"
  button.style.borderRadius = "var(--radius-md)"
  button.style.background = "var(--v2-background-bg-inverse)"
  button.style.color = "var(--v2-icon-icon-inverse)"
  button.style.boxShadow = "var(--shadow-xs)"
  button.style.padding = "0"
  button.style.cursor = "pointer"
  button.style.position = "relative"
  // It overlaps the line number, which Pierre stacks at 1; Pierre's own gutter button uses 4.
  button.style.zIndex = "4"
  button.style.left = "-4px"
  button.style.top = "calc((var(--diffs-line-height, 24px) - 20px) / 2)"

  let state = INITIAL_HOVER_COMMENT_STATE
  // Whether the last press went to Pierre, which then opens the draft itself.
  let forwarded = false
  // Reused for every pointer move and scroll so tracking allocates nothing.
  const syncEvent: HoverCommentSync = { type: "hover.synced", lineNumber: undefined, side: undefined }

  const dispatch = (event: HoverCommentEvent) => {
    const next = transitionHoverComment(state, event)

    if (next === state) return
    const active = selectHoverActive(state)
    state = next

    if (active && !selectHoverActive(state)) {
      document.removeEventListener("pointermove", sync)
      document.removeEventListener("scroll", sync, true)
    }
  }

  // The hovered line changes when the pointer moves or when content scrolls under a stationary pointer, so track both
  // with passive listeners instead of polling every animation frame.
  const sync = () => {
    if (!button.isConnected) return
    const hovered = props.getHoveredLine()
    syncEvent.lineNumber = hovered?.lineNumber
    syncEvent.side = hovered?.side
    dispatch(syncEvent)
  }

  document.addEventListener("pointermove", sync, { passive: true })
  document.addEventListener("scroll", sync, { passive: true, capture: true })
  button.addEventListener("mouseenter", sync)
  button.addEventListener("mousemove", sync)
  // Pierre skips presses on a custom gutter button when it selects lines, so hand the press to the line number under
  // the button: dragging from it then selects lines and ends in a draft for them. On a line that is already selected
  // the press stays here, as Pierre would unselect or shrink the range, and the click comments on the whole range.
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault()
    event.stopPropagation()
    sync()
    const line = selectHoverLine(state)
    forwarded = !line || !props.isSelected(line)

    if (!forwarded) return
    const slot = button.assignedSlot ?? button.parentElement?.assignedSlot
    slot?.closest("[data-column-number]")?.dispatchEvent(new PointerEvent("pointerdown", event))
  })
  button.addEventListener("mousedown", (event) => {
    event.preventDefault()
    event.stopPropagation()
    sync()
  })
  button.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    sync()
    const line = selectHoverLine(state)

    // A keyboard press has no pointer, so it never went to Pierre.
    if (line && (event.detail === 0 || !forwarded)) props.onSelect(line)
  })

  return {
    button,
    dispose: () => dispatch({ type: "disposed" }),
    canReuse: () => selectHoverActive(state),
  }
}
