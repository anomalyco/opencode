import { desktopDownload, desktopOS, getDownloadHref } from "~/lib/desktop-build"
import { copySelection } from "~/lib/clipboard"
import { browserPlatform } from "~/lib/user-agent"
import { $, $$, on, t, target } from "../dom"

/**
 * A product's download and install actions on the page (ProductAction in products.tsx;
 * src/client/menus.ts opens their menus and sheets). A desktop Download button starts the OS's usual
 * build until the browser has said which chip or Linux build this computer needs, then that one. An
 * install command's row copies its command and says "Copied" for 1.5s.
 */
export default function productAction() {
  const buttons = $$("[data-desktop-download]")
  if (buttons.length)
    void desktopDownload(desktopOS(browserPlatform())).then(
      (found) => found && buttons.forEach((button) => button.setAttribute("href", getDownloadHref(found))),
    )
  let last: { mark: (copied: boolean) => void; timer: number } | undefined
  on("click", (event) => {
    const row = target(event).closest<HTMLElement>(
      'button[data-funnel-copy]:is([data-slot="install"], [data-slot="row"])',
    )
    const command = row && $('[data-slot="command"]', row)?.textContent
    if (!row || !command) return
    const mark = (copied: boolean) => {
      row.toggleAttribute("data-copied", copied)
      // The menu's row shows one of its two labels (products.css); the sheet's says it.
      const idle = $('[data-slot="idle"]', row)
      const status = $('[data-slot="status"]', row)
      if (!idle && status) status.textContent = t(copied ? "site.action.copied" : "site.action.copy")
      idle?.setAttribute("aria-hidden", String(copied))
      $('[data-slot="done"]', row)?.setAttribute("aria-hidden", String(!copied))
    }
    const done = () => {
      if (last) clearTimeout(last.timer)
      last?.mark(false)
      mark(true)
      last = { mark, timer: window.setTimeout(() => mark(false), 1500) }
    }
    // Embedded browsers that block the Clipboard API get the old copy command instead.
    void (navigator.clipboard?.writeText(command) ?? Promise.reject()).then(
      done,
      () => copySelection(command) && done(),
    )
  })
}
