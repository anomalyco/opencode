import { settingsScroller } from "./scroller"
import type { SettingsView } from "./route"

/**
 * Finds a search activation's target, including one a scoped page mounts late, and highlights its row. Returns the
 * cleanup that stops looking and removes the highlight; the search machine decides when to call it.
 */
export function startSettingsSearchReveal(
  root: HTMLElement,
  view: SettingsView,
  callbacks: { onHighlighted: () => void; onCompleted: () => void },
) {
  const abort = new AbortController()

  const reveal = () => {
    const panel = root.querySelector<HTMLElement>(".settings-panel:not([hidden])")

    const control = panel?.querySelector<HTMLElement>(
      view.target ? `[data-action="${CSS.escape(view.target)}"]` : ".settings-tab-header-row, .settings-about-intro",
    )

    if (!panel || !control || !control.getClientRects().length) return false

    const row =
      control.closest<HTMLElement>('[data-component="settings-row"], [data-component="settings-list"] > *') ?? control

    if (!view.target) settingsScroller(panel).scrollTop = 0

    if (view.target) row.scrollIntoView({ block: "center", inline: "nearest" })
    const tabIndex = row.getAttribute("tabindex")
    row.setAttribute("data-search-target", view.target ? "row" : "header")
    abort.signal.addEventListener("abort", () => {
      row.removeAttribute("data-search-target")

      if (tabIndex === null) row.removeAttribute("tabindex")

      if (tabIndex !== null) row.setAttribute("tabindex", tabIndex)
    })
    root.addEventListener(
      "animationend",
      (event) => {
        if (event.target === row && event.animationName === "settings-search-reveal") callbacks.onCompleted()
      },
      { signal: abort.signal },
    )
    // Selecting another result can reuse the same header before the browser paints the removal.
    row.getAnimations({ subtree: true }).forEach((animation) => {
      if (!(animation instanceof CSSAnimation) || animation.animationName !== "settings-search-reveal") return
      animation.currentTime = 0
      animation.play()
    })

    if (view.type !== "root") {
      const focus = view.target ? row : (panel.querySelector<HTMLInputElement>(".settings-tab-search input") ?? row)

      if (focus === row) row.tabIndex = -1
      focus.focus({ preventScroll: true })
    }

    callbacks.onHighlighted()

    return true
  }

  const observer = new MutationObserver(() => {
    if (reveal()) observer.disconnect()
  })

  abort.signal.addEventListener("abort", () => observer.disconnect())
  queueMicrotask(() => {
    if (abort.signal.aborted || reveal()) return
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class"] })
  })

  return () => abort.abort()
}
