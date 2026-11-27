// The docs pages' only script. Pages are plain HTML rendered from the site's components (no
// hydration); this drives them with listeners delegated from the document, keyed on the attributes
// those components render: the theme switch, copy buttons, heading links, tabs, the section lockup's
// menus, the phone menus, the Contents rail, search, the status bars and the funnel.
import { Funnel } from "../lib/funnel"
import { downloadOf, surfaceOf, targetOf } from "../lib/funnel-config"
import { startContents } from "../component/site/contents-spy"
import { copyHeadingLinks, copyWithFeedback } from "../component/site/copy-feedback"
import { holdOpenMenu } from "../component/site/menu-hold"
import { navMenusOnIntent } from "../component/site/nav-intent"
import { isSearchShortcut } from "../component/site/search-key"
import { sectionNavScroll } from "../component/site/site-frame"
import { startThemeSwitch } from "../component/site/theme-switch"

// The page reports to the Console's funnel like the site's (lib/funnel.ts), in its language (English but on the V1
// docs' other languages), at the host's root like the site; their config is built in, as a chunk would bring Vite's
// preload helper with it.
Funnel.start(async () => ({ surfaceOf, targetOf, localeOf: () => site.dataset.locale ?? "en", base: "", downloadOf }))

const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) =>
  root.querySelector<T>(selector)
const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => [
  ...root.querySelectorAll<T>(selector),
]
const site = $("[data-site]")!
// The page's docs set's base, which search results and links start from, and what the page says in
// its language, with {{params}} to fill in (DocsLayout.tsx).
const base = site.dataset.docsBase!
const strings: Record<string, string> = JSON.parse(site.dataset.strings!)
const fill = (text: string, params: Record<string, string>) => text.replace(/\{\{(\w+)\}\}/g, (_, name) => params[name])
const html = document.documentElement
const on = <K extends keyof DocumentEventMap>(type: K, listener: (event: DocumentEventMap[K]) => void) =>
  document.addEventListener(type, listener)
const phone = matchMedia("(max-width: 60rem)")
// Arrow keys by the direction they move in: left and right swap in a right-to-left page.
const inline = (key: string) =>
  html.dir === "rtl" ? ({ ArrowLeft: "ArrowRight", ArrowRight: "ArrowLeft" }[key] ?? key) : key
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

// The theme switch (component/site/theme-switch.ts), saved as the site saves it, so the docs and the
// site share one choice, and heading links (copy-feedback.ts), as on the site's pages.
startThemeSwitch(site, (current, next) => fill(strings.cycle, { theme: strings[current], next: strings[next] }))
copyHeadingLinks(strings.linkCopied, strings.copyFailed)

const clipboard = (text: string) => navigator.clipboard.writeText(text)

on("click", (event) => {
  const target = event.target as Element
  const copy = target.closest<HTMLElement>("[data-code]")
  // Copy with feedback in place (copy-feedback.ts): the live region after the button says how it went.
  if (copy) return copyWithFeedback(copy, () => clipboard(copy.dataset.code ?? ""), strings.copied, strings.codeFailed)

  const markdown = target.closest<HTMLElement>("[data-copy-markdown]")
  if (markdown)
    return copyWithFeedback(
      markdown,
      () =>
        fetch(location.pathname, { headers: { Accept: "text/markdown" } }).then((response) =>
          response.ok ? response.text().then(clipboard) : Promise.reject(),
        ),
      strings.markdownCopied,
      strings.copyFailed,
    )

  const tab = target.closest<HTMLElement>("[data-code-tab], [data-plan-tab]")
  if (tab) return selectTab(tab)

  const section = target.closest("[data-slot=section-toggle]")
  if (section) return toggleSection()
})

// Code tabs, and plan tabs (which switch together across the page by their sync key and are remembered).
function selectTab(tab: HTMLElement) {
  const plan = tab.dataset.planTab
  const owner = tab.closest<HTMLElement>("[data-code-tabs], [data-plan-tabs]")!
  const groups = plan ? $$(`[data-plan-tabs][data-sync-key="${owner.dataset.syncKey}"]`) : [owner]
  if (plan) localStorage.setItem(`docs-plan-tabs:${owner.dataset.syncKey}`, plan)
  const index = $$("[role=tab]", owner).indexOf(tab)
  for (const group of groups) {
    const tabs = $$("[role=tab]", group)
    const at = plan ? tabs.findIndex((item) => item.dataset.planTab === plan) : index
    tabs.forEach((item, i) => {
      item.setAttribute("aria-selected", String(i === at))
      item.tabIndex = i === at ? 0 : -1
    })
    $$("[role=tabpanel]", group).forEach((panel, i) => (panel.hidden = i !== at))
  }
}

$$("[data-plan-tabs]").forEach((tabs) => {
  const plan = localStorage.getItem(`docs-plan-tabs:${tabs.dataset.syncKey}`)
  const tab = plan && $<HTMLElement>(`[data-plan-tab="${plan}"]`, tabs)
  if (tab) selectTab(tab)
})

// The phone section menu (the sidebar folded into a button).
function toggleSection(open?: boolean) {
  const nav = $("[data-component=section-nav]")!
  const next = open ?? !nav.hasAttribute("data-open")
  nav.toggleAttribute("data-open", next)
  // The section list and the Contents list drop over the same page, so one closes the other.
  const contents = $<HTMLDetailsElement>("[data-component=contents-menu][open]")
  if (next && contents) contents.open = false
  $("[data-slot=section-toggle]", nav)!.setAttribute("aria-expanded", String(next))
  holdOpenMenu()
}

phone.addEventListener("change", () => toggleSection(false))

// The shared logo right-click menu (packages/nav-menus), loaded on first use (nav-intent.ts).
navMenusOnIntent({ link: (path) => path })

on("pointerdown", (event) => {
  const target = event.target as Element
  const section = $("[data-component=section-nav][data-open]")
  if (section && !section.contains(target)) toggleSection(false)
})

// Arrow keys, Home and End move between tabs.
on("keydown", (event) => {
  const tab = (event.target as Element).closest?.<HTMLElement>("[data-code-tab], [data-plan-tab]")
  if (!tab) return
  const tabs = $$("[role=tab]", tab.parentElement!)
  const at = tabs.indexOf(tab)
  const next = { Home: 0, End: tabs.length - 1, ArrowRight: at + 1, ArrowLeft: at - 1 }[inline(event.key)]
  if (next === undefined) return
  event.preventDefault()
  const item = tabs[(next + tabs.length) % tabs.length]
  selectTab(item)
  item.focus()
})

// The V1 docs' language select (DocsFooter.tsx) opens the page in the language chosen.
on("change", (event) => {
  const select = (event.target as Element).closest<HTMLSelectElement>("[data-docs-lang]")
  if (select) location.assign(select.value)
})

// Escape closes the section menu (the Contents menu closes itself, contents-spy.ts) and gives focus
// back to its button; "/", ⌘K and Ctrl+K open search (search-key.ts); "0" goes to the site's home
// page, as on the site's pages (src/client/entry.ts, which also has the nav's number keys).
on("keydown", (event) => {
  if (event.key === "Escape" && $("[data-component=section-nav][data-open]")) {
    toggleSection(false)
    $("[data-slot=section-toggle]")?.focus()
  }
  if (isSearchShortcut(event)) {
    event.preventDefault()
    return openSearch("shortcut")
  }
  const typing = (event.target as Element).closest?.("input, textarea, select, [contenteditable]")
  if (event.key === "0" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.repeat && !typing)
    location.assign("/")
})

// The section nav scrolls under the logo and lockup, as on the site's pages (component/site/site-frame.ts).
const nav = $('[data-component="sidebar"] > [data-component="section-nav"]')!
sectionNavScroll(nav)

// The sidebar leaves with the article at the page's end, but the logo and lockup stay fixed
// (site.css): while it is on its way out its items pass under them, and data-under fades them there,
// as Site does on the site's own pages.
const sidebar = nav.parentElement!
const under = () => {
  sidebar.toggleAttribute("data-under", sidebar.getBoundingClientRect().top < -0.5)
  site.toggleAttribute("data-scrolled", scrollY > 4)
}
addEventListener("scroll", under, { passive: true })
addEventListener("resize", under, { passive: true })
under()

// The phone Contents bar names the section being read. A new name replaces
// the old within the label's own line: the old leaves upward (4px, fading out, 150ms) as the new comes
// up from 4px below (fading in, 200ms), both on the strong ease-out, transform and opacity only. A swap
// mid-swap starts from where the words are; swaps closer together than 120ms (a fast scroll) cut
// straight to the latest name, so nothing queues. The first name and reduced motion swap at once. The
// accessible name follows ("Contents: <section>"); it isn't a live region, so scrolling announces nothing.
const contentsBar = $<HTMLElement>("[data-docs-contents]")
const ease = "cubic-bezier(0.23, 1, 0.32, 1)"
let swappedAt = -Infinity
function nameSection(title: string, animate: boolean) {
  const label = contentsBar && $("[data-slot=label]", contentsBar)
  if (!label) return
  $("summary", contentsBar!)!.setAttribute("aria-label", fill(strings.contents, { section: title }))
  const current = label.querySelector<HTMLElement>("[data-slot=word]:not([data-leaving])")!
  if (current.textContent === title) return
  const word = document.createElement("span")
  word.dataset.slot = "word"
  word.textContent = title
  const now = performance.now()
  const instant = !animate || now - swappedAt < 120 || matchMedia("(prefers-reduced-motion: reduce)").matches
  swappedAt = now
  $$("[data-leaving]", label).forEach((leaving) => leaving.remove())
  if (instant) return current.replaceWith(word)
  const style = getComputedStyle(current)
  const from = { opacity: style.opacity, transform: style.transform === "none" ? "translateY(0)" : style.transform }
  current.getAnimations().forEach((animation) => animation.cancel())
  current.dataset.leaving = ""
  label.append(word)
  current
    .animate([from, { opacity: 0, transform: "translateY(-4px)" }], { duration: 150, easing: ease, fill: "forwards" })
    .finished.then(
      () => current.remove(),
      () => undefined,
    )
  word.animate(
    [
      { opacity: 0, transform: "translateY(4px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 200, easing: ease },
  )
}

// An address naming an endpoint or schema of the API reference opens its card, before Contents reads
// the page.
function reveal() {
  const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)))
  const card = target && target.closest("details")
  if (card) card.open = true
}
addEventListener("hashchange", reveal)
reveal()

// The Contents rail, and its phone bar (a dropdown) named after the section marked, as on the site's
// pages (contents-spy.ts).
let named = false
startContents((id) => {
  const link = $$<HTMLAnchorElement>("[data-docs-contents] a").find(
    (item) => decodeURIComponent(item.hash.slice(1)) === id,
  )
  if (link) nameSection(link.textContent ?? "", named)
  named = true
})

// Search: the site's palette over Pagefind's full-text index of the docs, loaded from its built file on
// first use or as soon as a search looks likely. Through `Function`, because Vite would wrap a plain
// import() in its preload helper, a second script on every page for a file it can't preload. The funnel
// gets counts, never the query.
type PagefindResult = { url: string; excerpt: string; meta: { title: string; section?: string } }
type Pagefind = { search(query: string): Promise<{ results: { data(): Promise<PagefindResult> }[] } | null> }
const dialog = $("[data-search-dialog]")!
const input = $<HTMLInputElement>("[data-search-input]", dialog)!
const results = $("[role=listbox]", dialog)!
const load = new Function("url", "return import(url)") as (url: string) => Promise<Pagefind>
let pagefind: Promise<Pagefind> | undefined
const preload = () => (pagefind ??= load(dialog.dataset.pagefindPath!))
let opener: HTMLElement | null = null
let chosen = false
let active = 0
const options = () => $$<HTMLAnchorElement>("[role=option]", results)
const searched = () => ({ results: options().length, query_len: input.value.trim().length })

if (!/Mac|iPhone|iPad/.test(navigator.platform))
  $$("[data-slot=search] kbd").forEach((kbd) => (kbd.textContent = "Ctrl K"))
on("keydown", (event) => (event.key === "Meta" || event.key === "Control") && void preload().catch(() => undefined))
for (const type of ["pointerover", "focusin"] as const)
  on(
    type,
    (event) => (event.target as Element).closest?.("[data-search-open]") && void preload().catch(() => undefined),
  )
on("click", (event) => (event.target as Element).closest("[data-search-open]") && openSearch("button"))

function openSearch(via: "shortcut" | "button") {
  if (!dialog.hidden) return input.focus()
  Funnel.track({ name: "search.opened", action: "opened", target: via, properties: { kind: "docs" } })
  opener = document.activeElement as HTMLElement | null
  chosen = false
  dialog.hidden = false
  html.style.overflow = "hidden"
  input.focus()
  input.select()
}

async function closeSearch() {
  if (dialog.hidden || dialog.hasAttribute("data-closing")) return
  if (!chosen) Funnel.track({ name: "search.closed", action: "dismissed", target: "", properties: searched() })
  dialog.toggleAttribute("data-closing", true)
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) await wait(120)
  dialog.removeAttribute("data-closing")
  dialog.hidden = true
  html.style.overflow = ""
  opener?.focus()
}

function highlight(index: number) {
  const items = options()
  active = Math.max(0, Math.min(index, items.length - 1))
  items.forEach((item, i) => {
    item.setAttribute("aria-selected", String(i === active))
    item.toggleAttribute("data-active", i === active)
  })
  input.setAttribute("aria-activedescendant", items[active]?.id ?? "")
  items[active]?.scrollIntoView({ block: "nearest" })
}

let latest = 0
input.addEventListener("input", async () => {
  const query = input.value.trim()
  const run = ++latest
  const search = query ? await (await preload()).search(query) : null
  const pages = await Promise.all((search?.results ?? []).slice(0, 8).map((result) => result.data()))
  if (run !== latest) return
  results.replaceChildren(
    ...pages.map((page, index) => {
      const option = document.createElement("a")
      // Pagefind indexes the docs from their own folder, so its URLs start after /docs.
      option.href = page.url.startsWith(base) ? page.url : `${base.slice(0, -1)}${page.url}`
      option.id = `docs-search-${index}`
      option.setAttribute("role", "option")
      option.dataset.slot = "option"
      option.innerHTML =
        '<span data-slot="text"><span data-slot="title"></span><span data-slot="snippet"></span></span><span data-slot="context"></span>'
      $("[data-slot=title]", option)!.textContent = page.meta.title
      $("[data-slot=context]", option)!.textContent = page.meta.section ?? ""
      // Pagefind's excerpt is HTML: the page's text, escaped, with the matches in <mark>.
      $("[data-slot=snippet]", option)!.innerHTML = page.excerpt
      return option
    }),
  )
  if (query && !pages.length) {
    const empty = document.createElement("p")
    empty.dataset.slot = "empty"
    // The sentence in the page's language, with the query and the link in their places, all as text.
    const none = document.createElement("span")
    none.textContent = fill(strings.noResults, { query })
    const link = document.createElement("a")
    link.href = base
    link.textContent = strings.browse
    empty.append(
      ...strings.empty
        .split(/(\{\{\w+\}\})/)
        .map((part) => (part === "{{results}}" ? none : part === "{{link}}" ? link : part)),
    )
    results.append(empty)
  }
  input.setAttribute("aria-expanded", String(!!query))
  highlight(0)
})

dialog.addEventListener("keydown", (event) => {
  const mod = event.metaKey || event.ctrlKey
  const moves: Record<string, number> = { ArrowDown: active + 1, ArrowUp: active - 1 }
  if (mod) Object.assign(moves, { Home: 0, End: options().length - 1 })
  if (event.key in moves) {
    event.preventDefault()
    highlight(moves[event.key])
  } else if (event.key === "Enter" && options()[active]) {
    event.preventDefault()
    const option = options()[active]
    choose(option)
    if (mod) open(option.href, "_blank", "noopener")
    else location.assign(option.href)
  } else if (event.key === "Tab") event.preventDefault()
})
// Escape closes search wherever focus is: a click inside the panel but not in its field moves focus to
// the page, and the dialog's own listener then never sees the key.
on("keydown", (event) => {
  if (event.key !== "Escape" || dialog.hidden) return
  event.preventDefault()
  void closeSearch()
})
dialog.addEventListener("pointermove", (event) => {
  const option = (event.target as Element).closest<HTMLAnchorElement>("[role=option]")
  if (option) highlight(options().indexOf(option))
})
dialog.addEventListener("click", (event) => {
  const target = event.target as Element
  const option = target.closest<HTMLAnchorElement>("[role=option]")
  if (option) return choose(option)
  if (target.closest("[data-slot=backdrop], [data-slot=close]")) void closeSearch()
})

// A chosen result is reported before the page it opens starts to load.
function choose(option: HTMLAnchorElement) {
  chosen = true
  const target = `link:${new URL(option.href).pathname}`.replace(/[^A-Za-z0-9/_.:+-]+/g, "-").slice(0, 96)
  Funnel.track({
    name: "search.selected",
    action: "selected",
    target,
    properties: { rank: options().indexOf(option) + 1, ...searched() },
  })
}

// The status bars, as the site's footer shows them: the last five 3-hour windows by their worst
// service, then the live status (the site's /status.json). Asked for once the footer comes near, and
// kept five minutes in sessionStorage, since every docs page is a full load.
type Status = "operational" | "degraded" | "outage" | "unknown"
function showStatus(bars: Status[]) {
  const link = $("[data-component=status]")
  if (!link) return
  const current = bars.at(-1)!
  const normal = current === "operational"
  link.dataset.state = current
  link.title = strings[current]
  // As in the site's footer, "Normal" or else "Status"; screen readers hear the headline instead.
  $("[data-slot=sr-only]", link)!.textContent = strings.statusPrefix + (normal ? "" : strings[current])
  const text = $("[data-slot=status-text]", link)!
  text.textContent = normal ? strings.normal : strings.status
  if (normal) text.removeAttribute("aria-hidden")
  else text.setAttribute("aria-hidden", "true")
  $$("[data-slot=bars] > span", link).forEach((bar, index) => (bar.dataset.state = bars[index] ?? "unknown"))
}
const saved = JSON.parse(sessionStorage.getItem("docs-status-bars") ?? "null") as { bars: Status[]; at: number } | null
if (saved?.bars?.length === 6) showStatus(saved.bars)
const footerStatus = $("[data-component=status]")
if (footerStatus && (!saved || Date.now() - saved.at > 300_000)) {
  const near = new IntersectionObserver(
    (entries) => {
      if (!entries[0].isIntersecting) return
      near.disconnect()
      fetch("/status.json", { signal: AbortSignal.timeout(10_000) })
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((body: { bars: Status[] }) => {
          sessionStorage.setItem("docs-status-bars", JSON.stringify({ bars: body.bars, at: Date.now() }))
          showStatus(body.bars)
        })
        .catch(() => undefined)
    },
    { rootMargin: "100% 0px" },
  )
  near.observe(footerStatus)
}
