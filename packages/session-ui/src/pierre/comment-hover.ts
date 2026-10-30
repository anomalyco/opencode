export type HoverCommentLine = {
  lineNumber: number
  side?: "additions" | "deletions"
}

export function createHoverCommentUtility(props: {
  label: string
  getHoveredLine: () => HoverCommentLine | undefined
  onSelect: (line: HoverCommentLine) => void
}) {
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
  button.style.background = "var(--icon-interactive-base)"
  button.style.color = "var(--white)"
  button.style.boxShadow = "var(--shadow-xs)"
  button.style.padding = "0"
  button.style.cursor = "pointer"
  button.style.position = "relative"
  button.style.left = "30px"
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

  document.addEventListener("pointermove", onHoverInvalidated, { passive: true })
  document.addEventListener("scroll", onHoverInvalidated, { passive: true, capture: true })
  button.addEventListener("mouseenter", sync)
  button.addEventListener("mousemove", sync)
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault()
    event.stopPropagation()
    sync()
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
