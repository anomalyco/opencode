import { raf } from "./frame"

function cursorLabels(editor: HTMLElement) {
  const widgets = Array.from(editor.querySelectorAll("affine-doc-remote-selection-widget"))
  return widgets.flatMap((widget) => {
    const root = widget.shadowRoot
    if (!root) return []
    return Array.from(root.querySelectorAll("div"))
      .filter((el) => el instanceof HTMLElement)
      .filter((el) => {
        const style = getComputedStyle(el)
        return style.whiteSpace === "nowrap" && style.textOverflow === "ellipsis"
      })
  })
}

function flipCursorLabels(editor: HTMLElement) {
  const edge = editor.getBoundingClientRect().right - 8
  cursorLabels(editor).forEach((label) => {
    label.style.transform = ""
    label.style.transformOrigin = ""
    label.style.maxWidth = "160px"
    const rect = label.getBoundingClientRect()
    const right = rect.left + Math.min(label.scrollWidth, 160)
    const overflow = Math.max(rect.right, right) - edge
    if (overflow <= 0) return
    label.style.transform = `translateX(-${Math.ceil(Math.max(rect.width - 8, overflow))}px)`
    label.style.transformOrigin = "right bottom"
    const left = label.getBoundingClientRect().left
    if (left >= 8) return
    label.style.maxWidth = `${Math.max(48, edge - 8)}px`
  })
}

export function watchCursorLabels(editor: HTMLElement, host: HTMLElement) {
  const task = raf(() => flipCursorLabels(editor))
  const obs = new MutationObserver(() => task.run())
  const bind = () => {
    editor.querySelectorAll("affine-doc-remote-selection-widget").forEach((widget) => {
      if (!widget.shadowRoot) return
      obs.observe(widget.shadowRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style"],
      })
    })
    task.run()
  }
  const roots = new MutationObserver(bind)
  roots.observe(editor, { childList: true, subtree: true })
  const update = () => task.run()
  const viewport = editor.querySelector(".affine-page-viewport")
  host.addEventListener("scroll", update, true)
  viewport?.addEventListener("scroll", update, true)
  window.addEventListener("resize", update)
  bind()
  return () => {
    task.stop()
    obs.disconnect()
    roots.disconnect()
    host.removeEventListener("scroll", update, true)
    viewport?.removeEventListener("scroll", update, true)
    window.removeEventListener("resize", update)
  }
}
