import { marks } from "~/i18n/rich"
import { desktopBuild, desktopOS } from "~/lib/desktop-build"
import { browserPlatform } from "~/lib/user-agent"
import { $, $$, t, target } from "../dom"

/**
 * A product page's download section (download-sections.tsx ProductDownload, and Browse's Install
 * section): the Copy button of a command row, or a click on the command that isn't a drag or a double
 * click (copyOnClick), copies it, and the button says "Copied" for a moment, one row at a time, as
 * does the Mobile page's pairing command (pair-panel.tsx). Every row's button takes the width of the
 * widest, once the web fonts have loaded (alignActions). The Desktop page's list marks this computer's
 * build once the browser has said which it is.
 */
export default function downloadList(body: HTMLElement) {
  if ($("li[data-build]", body))
    void desktopBuild(desktopOS(browserPlatform())).then((build) => {
      const row = build && $(`li[data-build="${build}"]`, body)
      const name = row && $('[data-slot="name"]', row)
      if (!row || !name) return
      row.toggleAttribute("data-current", true)
      const detail = document.createElement("span")
      detail.dataset.slot = "detail"
      detail.textContent = t("site.download.thisComputer")
      name.append(detail)
    })

  void document.fonts.ready.then(() => {
    const buttons = $$('[data-component="download-list"] [data-component="site-button"]', body)
    body.style.setProperty("--action-width", `${Math.max(...buttons.map((button) => button.scrollWidth))}px`)
  })

  let shown: { button: HTMLElement; label: Node[] } | undefined
  let timer = 0
  const restore = () => shown?.button.replaceChildren(...shown.label)
  // The button says `message` ("Copied … command", its method for screen readers only) for 1.5s.
  const flash = (button: HTMLElement, message: string) => {
    restore()
    shown = { button, label: [...button.childNodes] }
    button.replaceChildren(
      ...marks(message).map((part) => {
        if (part.mark !== "sr") return part.text
        const span = document.createElement("span")
        span.dataset.slot = "sr-only"
        span.textContent = part.text
        return span
      }),
    )
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      restore()
      shown = undefined
    }, 1500)
  }
  let start = { x: 0, y: 0 }
  body.addEventListener("pointerdown", (event) => (start = { x: event.clientX, y: event.clientY }))
  body.addEventListener("click", (event) => {
    const pair = target(event).closest<HTMLElement>('[data-funnel-copy="pair"]')
    const pairButton = pair && target(event).closest<HTMLElement>("button")
    if (pair && pairButton) {
      void navigator.clipboard.writeText($("code", pair)?.textContent ?? "")
      return flash(pairButton, t("site.action.copiedThisCommand"))
    }
    const row = target(event).closest<HTMLElement>('[data-slot="copy-row"]')
    const command = row && $("[data-copy-command]", row)
    const button = row && $("button", row)
    if (!row || !command || !button) return
    const onCommand = target(event).closest("[data-copy-command]")
    if (!onCommand && !target(event).closest("button")) return
    if (onCommand && (event.detail > 1 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4)) return
    void navigator.clipboard.writeText(command.textContent ?? "")
    flash(button, t("site.action.copiedCommand", { method: $('[data-slot="method"]', row)?.textContent ?? "" }))
  })
}
