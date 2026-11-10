// The static pages' only script (src/static/render.tsx). The pages are plain HTML rendered from the
// site's components, with no hydration; this drives them with listeners delegated from the document,
// keyed on the attributes those components render, and loads the rest on intent: search, the Markdown
// view, the orb's pop-up, the logo menu, and each island's code (islands.ts). The not-found page has
// none of the site's frame (Site): its arcade island brings its own, search and tooltips included
// (arcade/chrome.tsx), so it gets the islands only.
import { Funnel } from "~/lib/funnel"
import { installConsoleStub } from "~/lib/console-stub"
import type { SearchVia } from "~/component/site/search"
import { markdownShortcut } from "~/component/site/markdown-key"
import { revealHandedOff } from "~/component/site/search-reveal"
import { startTooltips } from "~/component/site/tooltips"
import { inlineKey } from "~/lib/direction"
import { $, $$, on, site, target } from "./dom"
import { startContents } from "./contents"
import { startCopy } from "./copy"
import { startFaq } from "./faq"
import { startFrame } from "./footer"
import { startIslands } from "./islands"
import { closeMenus, startMenus } from "./menus"
import { startTheme } from "./theme"

// The page reports to the Console's funnel from its markup, as every page does (lib/funnel.ts).
Funnel.start(() => import("~/lib/funnel-config").then((module) => module.funnelConfig()))

if ($("[data-site][data-page]")) startShell()
startIslands()

function startShell() {
  startTheme()
  startMenus()
  startCopy()
  startFaq()
  startContents()
  startFrame()
  const tip = $('[data-component="tooltip"]')
  if (tip) startTooltips(tip)
  revealHandedOff()

  const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1500))
  // window.opencode and its hint for developers who open DevTools (lib/console-stub.ts).
  idle(() => installConsoleStub())
  // The corner orb, after the page.
  addEventListener("load", () => idle(() => void import("./overlays/orb").then((module) => module.default())), {
    once: true,
  })

  // Search: ⌘K, Ctrl+K or "/" (when not typing). ⌘ or Ctrl on its own starts loading the palette, so a
  // fast ⌘K finds results; once it is in the page it handles the shortcut itself, and a shortcut pressed
  // while it loads opens it as it arrives.
  const pending: { via?: SearchVia } = {}
  let search: Promise<unknown> | undefined
  let searching = false
  const loadSearch = () =>
    (search ??= import("./overlays/search").then((module) => module.default(pending)).then(() => (searching = true)))
  on("keydown", (event) => {
    if (searching) return
    if (event.key === "Meta" || event.key === "Control") return void loadSearch()
    if (event.defaultPrevented || event.altKey || event.repeat || target(event).closest("[contenteditable]")) return
    const command = (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "k"
    const slash =
      event.key === "/" && !event.metaKey && !event.ctrlKey && !target(event).closest("input, textarea, select")
    if (!command && !slash) return
    event.preventDefault()
    pending.via = slash ? "slash" : "shortcut"
    void loadSearch()
  })

  // The Markdown view: the footer's switch (a link to the page's .md, so a new tab still works), or "m"
  // then "d". Its code and the page's Markdown load as the pointer reaches the switch, or on "m".
  let markdown: typeof import("./overlays/markdown") | undefined
  const loadMarkdown = () => import("./overlays/markdown").then((module) => (markdown = module))
  const prefetchMarkdown = () => void loadMarkdown().then((module) => module.prefetch())
  const markdownSwitch = '[data-funnel^="markdown-view:"]'
  for (const type of ["pointerover", "focusin"] as const)
    on(type, (event) => target(event).closest(markdownSwitch) && prefetchMarkdown())
  on("click", (event) => {
    const button = target(event).closest(markdownSwitch)
    if (button) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      return void loadMarkdown().then((module) =>
        module.toggle(undefined, !!button.closest('[data-component="site-footer"]')),
      )
    }
    // The logo always leads to the real home page, so it leaves the Markdown view.
    if (target(event).closest('[data-slot="logo"]')) markdown?.leave()
  })
  if (site.hasAttribute("data-markdown-boot")) void loadMarkdown().then((module) => module.toggle(true))
  on(
    "keydown",
    markdownShortcut({
      prefetch: prefetchMarkdown,
      toggle: () => void loadMarkdown().then((module) => module.toggle()),
      shown: () => site.hasAttribute("data-markdown"),
    }),
  )

  // Number keys open the matching nav item and 0 the home page, unless the reader is typing or using a
  // shortcut (as Site does from its nav data); Escape closes what's open.
  on("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
    if (target(event).closest("input, textarea, select, [contenteditable]")) return
    const link =
      event.key === "0"
        ? $<HTMLAnchorElement>('[data-slot="logo"]')
        : $$<HTMLAnchorElement>('[data-component="nav"] li[data-nav-id] > a').find((item) =>
            $(`[data-slot="number"][data-n="${event.key}"]`, item),
          )
    if (!link) return
    event.preventDefault()
    // A shortcut is not keyboard navigation through the page: no focus ring is left behind.
    ;(document.activeElement as HTMLElement | null)?.blur()
    if (link.target === "_blank") return void open(link.href, "_blank", "noopener")
    location.assign(link.href)
  })
  on("keydown", (event) => event.key === "Escape" && !event.defaultPrevented && closeMenus())
  // A product page's previous and next links (product-page.tsx): the left and right arrow keys follow
  // them, unless focus is somewhere that uses those keys itself, or a menu, sheet or dialog is open.
  on("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.defaultPrevented) return
    const busy =
      'input, textarea, select, [contenteditable], [role="tablist"], [data-slot="track"], [data-slot="menu"], [popover], dialog'
    if (target(event).closest(busy) || $(":popover-open, dialog[open]")) return
    const link = $$<HTMLAnchorElement>('[data-component="product-cycle"] a')[inlineKey(event) === "ArrowLeft" ? 0 : 1]
    if (link) location.assign(link.href)
  })
  // The skip link moves focus to the content, leaving the address as it is.
  on("click", (event) => {
    if (!target(event).closest('[data-component="skip-link"]')) return
    event.preventDefault()
    $("#content")?.focus()
  })
}
