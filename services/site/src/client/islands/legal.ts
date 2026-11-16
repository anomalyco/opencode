import { inHistory, pinnedScroll, revealTab } from "~/component/site/legal-tabs"
import { checkPath, copyPath } from "~/component/site/icon-paths"
import { copySelection } from "~/lib/clipboard"
import { strip } from "~/lib/language"
import { refreshContents } from "~/component/site/contents-spy"
import { $, $$, on, target } from "../dom"

/**
 * A legal document on a static page (legal.tsx's LegalDocument): the Document and History tabs, with
 * #history in the address and the Contents rail listing History's parts while it shows; Copy as
 * Markdown; Save as PDF, whose cover and colophon render on the way to printing (legal-print.tsx);
 * and the Privacy Policy's analytics control.
 */
export default function legal(body: HTMLElement) {
  tabs(body)
  copyMarkdown()
  print()
  analytics()
}

function tabs(body: HTMLElement) {
  const bar = $('[data-slot="view-tabs"]')
  const view = $('[data-slot="history-view"]')
  const template = $<HTMLTemplateElement>('[data-slot="history-contents"]')
  if (!bar || !view || !template) return
  const sections = template.parentElement!.querySelector<HTMLElement>(':scope > [data-component="on-this-page"]')
  const list = template.content.firstElementChild as HTMLElement
  let open = false

  // Switches History in or out without moving the page: with the tab bar pinned, the page scrolls so
  // the bar stays pinned and the new view starts at its top under it.
  const show = (next: boolean) => {
    if (next === open) return
    const pinned = pinnedScroll(bar)
    open = next
    view.hidden = !open
    body.hidden = open
    $$('[role="tab"]', bar).forEach((tab) => {
      const selected = (tab.id === "tab-history") === open
      tab.setAttribute("aria-selected", String(selected))
      tab.tabIndex = selected ? 0 : -1
    })
    if (open) (sections ?? template).before(list)
    if (open) sections?.remove()
    if (!open && sections) list.replaceWith(sections)
    if (!open && !sections) list.remove()
    refreshContents()
    if (pinned !== undefined) scrollTo({ top: pinned, behavior: "instant" })
  }
  // History is linkable (#history, no navigation), and Back returns to the text.
  const choose = (next: boolean) => {
    if (next === open) return
    show(next)
    if (next) history.pushState(history.state, "", "#history")
    if (!next && inHistory(location.hash)) history.pushState(history.state, "", location.pathname + location.search)
  }

  show(inHistory(location.hash))
  addEventListener("popstate", () => show(inHistory(location.hash)))
  bar.addEventListener("click", (event) => {
    const tab = target(event).closest<HTMLElement>('[role="tab"]')
    if (!tab) return
    choose(tab.id === "tab-history")
    revealTab(tab)
  })
  // Arrows move between the two tabs, Home and End go to the first and last.
  bar.addEventListener("keydown", (event) => {
    const next =
      event.key === "Home"
        ? false
        : event.key === "End"
          ? true
          : /^Arrow(Left|Right)$/.test(event.key)
            ? !open
            : undefined
    if (next === undefined) return
    event.preventDefault()
    choose(next)
    const tab = $(`#tab-${next ? "history" : "document"}`, bar)
    tab?.focus({ preventScroll: true })
    if (tab) revealTab(tab)
  })
  // "Text last changed …" opens History.
  on("click", (event) => {
    if (!target(event).closest('[data-slot="dates"] a[href="#history"]')) return
    event.preventDefault()
    choose(true)
  })
}

// Copies the page's Markdown version (its .md URL), fetched on hover or focus so a click copies at
// once; the Clipboard API first, then a hidden text field for embedded browsers that block it. The
// label says "Copied" for 1.5s; on failure "Copy failed", and the Markdown opens in a new tab.
function copyMarkdown() {
  const button = $('[data-slot="copy-markdown"]')
  if (!button) return
  const url = `${strip(location.pathname)}.md`
  let text: Promise<string> | undefined
  let timer = 0
  const load = () =>
    (text ??= fetch(url).then((response) => {
      if (!response.ok) throw new Error(`${response.status}`)
      return response.text()
    }))
  const show = (state: "idle" | "copied" | "failed") => {
    button.dataset.state = state
    $$("[data-label]", button).forEach((label) => label.toggleAttribute("aria-hidden", label.dataset.label !== state))
    $("path", button)?.setAttribute("d", state === "copied" ? checkPath : copyPath)
    const status = button.nextElementSibling
    if (status?.matches('[role="status"]'))
      status.textContent = state === "idle" ? "" : ($(`[data-label="${state}"]`, button)?.textContent ?? "")
  }
  for (const type of ["pointerenter", "focus"]) button.addEventListener(type, () => void load().catch(() => undefined))
  button.addEventListener("click", async () => {
    const done = await load()
      .then((markdown) =>
        navigator.clipboard
          ? navigator.clipboard.writeText(markdown).then(
              () => true,
              () => copySelection(markdown),
            )
          : copySelection(markdown),
      )
      .catch(() => false)
    show(done ? "copied" : "failed")
    clearTimeout(timer)
    timer = window.setTimeout(() => show("idle"), 1500)
    if (!done) open(url, "_blank", "noopener")
  })
}

// Save as PDF prints the page with its cover. The cover's code loads once the page is idle, so File ›
// Print from the menu bar finds it ready for `beforeprint`; ⌘P or Ctrl+P before then waits for it.
function print() {
  let module: typeof import("./legal-print") | undefined
  const load = () => import("./legal-print").then((loaded) => (module = loaded))
  const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1500))
  idle(() => void load())
  addEventListener("beforeprint", () => module?.showPrint())
  on("click", (event) => {
    if (!target(event).closest('[data-slot="print"]')) return
    void load().then((loaded) => {
      loaded.showPrint()
      window.print()
    })
  })
  on("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "p" || module) return
    event.preventDefault()
    void load().then((loaded) => {
      loaded.showPrint()
      window.print()
    })
  })
  // "Print preview" in the layout editor opens the page with ?autoprint=1 (the server renders the cover).
  if (new URLSearchParams(location.search).get("autoprint") === "1")
    void document.fonts.ready.then(() => setTimeout(() => window.print(), 800))
}

// The Privacy Policy's analytics control (analytics-choice.ts) shows in the browser only: rendered
// into its host once the page is idle, as the hydrated page does after it loads.
function analytics() {
  const host = $('[data-slot="analytics-choice-host"]')
  if (host) void import("~/component/site/analytics-choice").then((module) => module.analyticsChoice(host))
}
