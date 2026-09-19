export type HoverCommentLine = {
  lineNumber: number
  side?: "additions" | "deletions"
}

export const LINE_COMMENT_ACTION_GAP = 8
const LINE_COMMENT_ACTION_SIZE = 20

export function createHoverCommentUtility(props: {
  label: string
  getHoveredLine: () => HoverCommentLine | undefined
  onSelect: (line: HoverCommentLine) => void
}) {
  if (typeof document === "undefined") return

  const button = document.createElement("button")
  button.type = "button"
  button.ariaLabel = props.label
  button.textContent = "+"
  button.style.width = `${LINE_COMMENT_ACTION_SIZE}px`
  button.style.height = `${LINE_COMMENT_ACTION_SIZE}px`
  button.style.display = "flex"
  button.style.alignItems = "center"
  button.style.justifyContent = "center"
  button.style.border = "none"
  button.style.borderRadius = "var(--radius-md)"
  button.style.background = "var(--v2-background-bg-inverse)"
  button.style.color = "var(--v2-icon-icon-inverse)"
  button.style.boxShadow = "var(--shadow-xs)"
  button.style.fontSize = "14px"
  button.style.lineHeight = "1"
  button.style.cursor = "pointer"
  button.style.position = "relative"
  button.style.zIndex = "110"
  button.style.left = "-4px"
  button.style.top = "calc((var(--diffs-line-height, 24px) - 20px) / 2)"

  let line: HoverCommentLine | undefined

  const sync = () => {
    const next = props.getHoveredLine()
    if (!next) return
    line = next
  }

  // The hovered line changes when the pointer moves or when content scrolls under
  // a stationary pointer, so track both with passive listeners instead of polling
  // every animation frame. There is no teardown hook for this utility; like the
  // rAF loop this replaced, the listeners self-detach on the first event after
  // the button leaves the DOM.
  const onHoverInvalidated = () => {
    if (!button.isConnected) {
      document.removeEventListener("pointermove", onHoverInvalidated)
      document.removeEventListener("scroll", onHoverInvalidated, true)
      return
    }
    sync()
  }

  const open = () => {
    const next = props.getHoveredLine() ?? line
    if (!next) return
    props.onSelect(next)
  }

  const startLineSelection = (event: PointerEvent) => {
    const number = button.parentElement?.assignedSlot?.parentElement?.parentElement
    if (!(number instanceof HTMLElement)) return
    number.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        button: event.button,
        buttons: event.buttons,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      }),
    )
  }

  document.addEventListener("pointermove", onHoverInvalidated, { passive: true })
  document.addEventListener("scroll", onHoverInvalidated, { passive: true, capture: true })
  button.addEventListener("mouseenter", sync)
  button.addEventListener("mousemove", sync)
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault()
    event.stopPropagation()
    sync()
    startLineSelection(event)
  })
  button.addEventListener("mousedown", (event) => {
    event.preventDefault()
    event.stopPropagation()
    sync()
  })
  button.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    open()
  })

  return button
}
