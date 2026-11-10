import { marks } from "~/i18n/rich"
import { $, $$, t, target } from "../dom"

/**
 * A download section's command rows (download-sections.tsx CopyRow, Browse's Install section): the
 * Copy button, or a click on the command that isn't a drag or a double click (copyOnClick), copies
 * it, and the button says "Copied" for a moment, one row at a time. Every row's button takes the
 * width of the widest, once the web fonts have loaded (alignActions).
 */
export default function downloadList(body: HTMLElement) {
  void document.fonts.ready.then(() => {
    const buttons = $$('[data-component="download-list"] [data-component="site-button"]', body)
    body.style.setProperty("--action-width", `${Math.max(...buttons.map((button) => button.scrollWidth))}px`)
  })

  let shown: { button: HTMLElement; label: Node[] } | undefined
  let timer = 0
  const restore = () => shown?.button.replaceChildren(...shown.label)
  let start = { x: 0, y: 0 }
  body.addEventListener("pointerdown", (event) => (start = { x: event.clientX, y: event.clientY }))
  body.addEventListener("click", (event) => {
    const row = target(event).closest<HTMLElement>('[data-slot="copy-row"]')
    const command = row && $("[data-copy-command]", row)
    const button = row && $("button", row)
    if (!row || !command || !button) return
    const onCommand = target(event).closest("[data-copy-command]")
    if (!onCommand && !target(event).closest("button")) return
    if (onCommand && (event.detail > 1 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4)) return
    void navigator.clipboard.writeText(command.textContent ?? "")
    restore()
    shown = { button, label: [...button.childNodes] }
    button.replaceChildren(
      ...marks(t("site.action.copiedCommand", { method: $('[data-slot="method"]', row)?.textContent ?? "" })).map(
        (part) => {
          if (part.mark !== "sr") return part.text
          const span = document.createElement("span")
          span.dataset.slot = "sr-only"
          span.textContent = part.text
          return span
        },
      ),
    )
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      restore()
      shown = undefined
    }, 1500)
  })
}
