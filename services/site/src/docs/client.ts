// The docs pages' only script. Pages are plain HTML rendered from the site's components (no
// hydration); this drives them with listeners delegated from the document, keyed on the attributes
// those components render: the theme switch, copy buttons, heading links, tabs, the section lockup's
// menus, the phone menus, the Contents rail, search, the status bars and the funnel.
import { Funnel } from "../lib/funnel"
import { downloadOf, surfaceOf, targetOf } from "../lib/funnel-config"
import { base } from "./config"

// The page reports to the Console's funnel like the site's (lib/funnel.ts). The docs are English, at the host's root
// like the site; their config is built in, as a chunk would bring Vite's preload helper with it.
Funnel.start(async () => ({ surfaceOf, targetOf, localeOf: () => "en", base: "", downloadOf }))

const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) =>
  root.querySelector<T>(selector)
const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => [
  ...root.querySelectorAll<T>(selector),
]
const site = $("[data-site]")!
const html = document.documentElement
const on = <K extends keyof DocumentEventMap>(type: K, listener: (event: DocumentEventMap[K]) => void) =>
  document.addEventListener(type, listener)
const phone = matchMedia("(max-width: 60rem)")
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

// The theme switch: system, light, dark, saved as the site saves it (opencode-theme), so the docs
// and the site share one choice.
const themes = ["system", "light", "dark"] as const
type Theme = (typeof themes)[number]
const themeNames = { system: "System", light: "Light", dark: "Dark" }
function showTheme(theme: Theme) {
  site.dataset.theme = theme
  const next = themes[(themes.indexOf(theme) + 1) % 3]
  const cycle = $('[data-component="theme-toggle"] [data-slot="cycle"]')
  cycle?.setAttribute("aria-label", `${themeNames[theme]} theme. Switch to ${themeNames[next]}`)
  $$("[data-slot=icon]", cycle ?? undefined).forEach((icon, index) =>
    icon.toggleAttribute("data-current", index === themes.indexOf(theme)),
  )
  $$<HTMLMetaElement>('meta[name="theme-color"]').forEach(
    (meta) =>
      (meta.content = theme === "dark" || (theme === "system" && meta.media.includes("dark")) ? "#0c0c0c" : "#fbfbfb"),
  )
  $<HTMLMetaElement>('meta[name="color-scheme"]')!.content = theme === "system" ? "light dark" : theme
}
showTheme((site.dataset.theme as Theme) ?? "system")

// Copy with feedback in place (DESIGN.md): the button's data-state shows "Copied" or "Failed" for
// 1.5s, and the live region after it says so.
async function copied(button: HTMLElement, write: () => Promise<unknown>, message: string, failure = "Couldn't copy") {
  const live = button.nextElementSibling?.matches("[aria-live]") ? button.nextElementSibling : undefined
  const run = String(Number(button.dataset.run ?? 0) + 1)
  button.dataset.run = run
  const state = await Promise.resolve()
    .then(write)
    .then(
      () => "copied",
      () => "failed",
    )
  button.dataset.state = state
  if (live) live.textContent = state === "copied" ? message : failure
  await wait(1500)
  // A later copy owns the label now.
  if (button.dataset.run !== run) return
  button.dataset.state = "idle"
  if (live) live.textContent = ""
}

const clipboard = (text: string) => navigator.clipboard.writeText(text)

on("click", (event) => {
  const target = event.target as Element
  const cycle = target.closest("[data-slot=cycle]")
  if (cycle) {
    const theme = themes[(themes.indexOf(site.dataset.theme as Theme) + 1) % 3]
    localStorage.setItem("opencode-theme", theme)
    return showTheme(theme)
  }

  const copy = target.closest<HTMLElement>("[data-code]")
  if (copy)
    return copied(
      copy,
      () => clipboard(copy.dataset.code ?? ""),
      "Copied to clipboard",
      "Couldn't copy. Select the code instead.",
    )

  const heading = target.closest<HTMLElement>("[data-heading-id]")
  if (heading) {
    const id = heading.dataset.headingId
    history.replaceState(history.state, "", `#${id}`)
    return copied(heading, () => clipboard(`${location.origin}${location.pathname}#${id}`), "Link copied")
  }

  const markdown = target.closest<HTMLElement>("[data-copy-markdown]")
  if (markdown)
    return copied(
      markdown,
      () =>
        fetch(location.pathname, { headers: { Accept: "text/markdown" } }).then((response) =>
          response.ok ? response.text().then(clipboard) : Promise.reject(),
        ),
      "Copied the page as Markdown",
    )

  const tab = target.closest<HTMLElement>("[data-code-tab], [data-plan-tab]")
  if (tab) return selectTab(tab)

  const section = target.closest("[data-slot=section-toggle]")
  if (section) return toggleSection()

  if (target.closest('[data-component="menu-toggle"]'))
    return toggleMenu(!site.querySelector("[data-component=site-menu-sheet][data-open]"))
  if (target.closest('[data-component="site-menu-sheet"] :is([data-slot=backdrop], a)')) return toggleMenu(false)
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

// The phone section menu (the sidebar folded into a button) and the phone menu sheet.
function toggleSection(open?: boolean) {
  const nav = $("[data-component=section-nav]")!
  const next = open ?? !nav.hasAttribute("data-open")
  nav.toggleAttribute("data-open", next)
  $("[data-slot=section-toggle]", nav)!.setAttribute("aria-expanded", String(next))
}

function toggleMenu(open: boolean) {
  const toggle = $('[data-component="menu-toggle"]')!
  $("[data-component=site-menu-sheet]")!.toggleAttribute("data-open", open)
  toggle.setAttribute("aria-expanded", String(open))
  toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu")
  for (const part of [$("[data-slot=frame]")!, $("[data-component=site-footer]")!]) part.inert = open
  html.style.overflow = open ? "hidden" : ""
}

phone.addEventListener("change", () => {
  toggleMenu(false)
  toggleSection(false)
  closeLockup()
})

// The docs lockup (component/site/docs-lockup.tsx): the chevron opens the sections menu, where "Docs"
// has its versions in a flyout beside it, or nested under it on phones and touch screens.
let lockup: HTMLElement | undefined
let subTimer = 0
const menuOf = (root: HTMLElement) => $("[data-slot=menu]", root)!
const rows = (root: HTMLElement) =>
  $$<HTMLAnchorElement>(
    root.querySelector("[data-submenu=nested]")
      ? "[data-slot=menu] [role=menuitem]:not([hidden] *)"
      : "[data-slot=menu] > [role=menuitem], [data-slot=menu] > [data-slot=parent] > [role=menuitem]",
    root,
  )

function openLockup(root: HTMLElement, focus?: "first" | "last" | "current") {
  closeLockup()
  lockup = root
  const menu = menuOf(root)
  const word = $("[data-slot=word]", root)!
  const box = word.getBoundingClientRect()
  menu.style.setProperty("--menu-text", `${(html.dir === "rtl" ? html.clientWidth - box.right : box.left) + 6}px`)
  menu.dataset.submenu = matchMedia("(max-width: 60rem), (hover: none), (pointer: coarse)").matches
    ? "nested"
    : "flyout"
  menu.hidden = false
  $$("[aria-haspopup=menu]:not([role=menuitem])", root).forEach((button) =>
    button.setAttribute("aria-expanded", "true"),
  )
  const items = rows(root)
  if (focus)
    (focus === "first"
      ? items[0]
      : focus === "last"
        ? items.at(-1)
        : (items.find((item) => item.matches("[aria-current]")) ?? items[0])
    )?.focus()
}

function closeLockup(refocus?: boolean) {
  if (!lockup) return
  const root = lockup
  lockup = undefined
  menuOf(root).hidden = true
  toggleSub(root, false)
  $$("[aria-haspopup=menu]:not([role=menuitem])", root).forEach((button) =>
    button.setAttribute("aria-expanded", "false"),
  )
  if (refocus) $("[data-slot=toggle]", root)?.focus()
}

function toggleSub(root: HTMLElement, open: boolean, focus?: boolean) {
  clearTimeout(subTimer)
  const parent = $("[data-slot=parent]", root)
  if (!parent) return
  parent.toggleAttribute("data-open", open)
  $("[data-slot=submenu]", parent)!.hidden = !open
  $$("[aria-expanded]", parent).forEach((item) => item.setAttribute("aria-expanded", String(open)))
  if (open && focus)
    ($('[aria-current="page"]', $("[data-slot=submenu]", parent)!) ?? $("[data-slot=submenu] a", parent))?.focus()
}

on("click", (event) => {
  const target = event.target as Element
  const root = target.closest<HTMLElement>('[data-component="docs-lockup"]')
  if (!root) return
  if (target.closest("[data-slot=toggle], [data-slot=trigger]"))
    return lockup === root ? closeLockup() : openLockup(root)
  const expand = target.closest("[data-slot=expand]")
  if (expand) return toggleSub(root, expand.getAttribute("aria-expanded") !== "true")
  if (target.closest("a")) closeLockup()
})

on("keydown", (event) => {
  const target = event.target as HTMLElement
  const root = target.closest?.<HTMLElement>('[data-component="docs-lockup"]')
  if (!root) return
  const key =
    html.dir === "rtl" ? ({ ArrowLeft: "ArrowRight", ArrowRight: "ArrowLeft" }[event.key] ?? event.key) : event.key
  if (target.matches("[data-slot=toggle], [data-slot=trigger]")) {
    if (key === "ArrowDown" || key === "Enter" || key === " ") openLockup(root, "current")
    else if (key === "ArrowUp") openLockup(root, "last")
    else return
    return event.preventDefault()
  }
  if (!lockup) return
  const items = rows(root)
  const at = items.indexOf(target as HTMLAnchorElement)
  const inSub = !!target.closest("[data-slot=submenu]") && menuOf(root).dataset.submenu === "flyout"
  const moves: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }
  if (key in moves && !inSub) {
    event.preventDefault()
    toggleSub(root, menuOf(root).dataset.submenu === "nested" && !!$("[data-slot=parent][data-open]", root))
    items[(moves[key] + items.length) % items.length]?.focus()
  } else if (key in moves) {
    event.preventDefault()
    const subs = $$<HTMLAnchorElement>("[data-slot=submenu] a", root)
    const i = subs.indexOf(target as HTMLAnchorElement)
    subs[
      ({ ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: subs.length - 1 }[key]! + subs.length) % subs.length
    ]?.focus()
  } else if (key === "ArrowRight" && target.closest("[data-slot=parent]") && !inSub) {
    event.preventDefault()
    toggleSub(root, true, true)
  } else if ((key === "ArrowLeft" && inSub) || (key === "Escape" && inSub)) {
    event.preventDefault()
    toggleSub(root, false)
    $("[data-slot=parent] > [role=menuitem]", root)?.focus()
  } else if (key === "Escape") {
    event.preventDefault()
    closeLockup(true)
  } else if (key === "Tab") closeLockup()
})

// The flyout opens while the pointer rests on "Docs" and closes 300ms after it leaves, so the pointer
// can cut across to it. Keyboard focus follows the pointer between rows, so only one row looks active.
on("pointerover", (event) => {
  if (event.pointerType !== "mouse" || !lockup) return
  const target = event.target as Element
  const row = target.closest<HTMLElement>("[role=menuitem]")
  if (row && lockup.contains(document.activeElement) && document.activeElement !== row)
    row.focus({ preventScroll: true })
  if (menuOf(lockup).dataset.submenu !== "flyout") return
  if (target.closest("[data-slot=parent]")) toggleSub(lockup, true)
  else if (target.closest("[data-slot=menu]")) {
    const root = lockup
    clearTimeout(subTimer)
    subTimer = window.setTimeout(() => toggleSub(root, false), 300)
  }
})

on("pointerdown", (event) => {
  const target = event.target as Element
  if (lockup && !lockup.contains(target)) closeLockup()
  const contents = $<HTMLDetailsElement>("[data-component=contents-menu][open]")
  if (contents && !contents.contains(target)) contents.open = false
})

// Arrow keys, Home and End move between tabs.
on("keydown", (event) => {
  const tab = (event.target as Element).closest?.<HTMLElement>("[data-code-tab], [data-plan-tab]")
  if (!tab) return
  const tabs = $$("[role=tab]", tab.parentElement!)
  const at = tabs.indexOf(tab)
  const next = { Home: 0, End: tabs.length - 1, ArrowRight: at + 1, ArrowLeft: at - 1 }[event.key]
  if (next === undefined) return
  event.preventDefault()
  const item = tabs[(next + tabs.length) % tabs.length]
  selectTab(item)
  item.focus()
})

// Escape closes what's open (menus return focus to their button); "0" goes to the site's home page,
// as on the site; "/", ⌘K and Ctrl+K open search.
on("keydown", (event) => {
  const typing = (event.target as Element).closest?.("input, textarea, select, [contenteditable]")
  if (event.key === "Escape") {
    const contents = $<HTMLDetailsElement>("[data-component=contents-menu][open]")
    if (contents) {
      contents.open = false
      $("summary", contents)?.focus()
    }
    if ($("[data-component=site-menu-sheet][data-open]")) {
      toggleMenu(false)
      $('[data-component="menu-toggle"]')?.focus()
    }
    if ($("[data-component=section-nav][data-open]")) {
      toggleSection(false)
      $("[data-slot=section-toggle]")?.focus()
    }
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault()
    return openSearch("shortcut")
  }
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat || typing) return
  if (event.key === "/") {
    event.preventDefault()
    openSearch("shortcut")
  }
  if (event.key === "0") location.assign("/")
})

// The section nav scrolls under the logo and lockup: it holds the wheel only while it can scroll and
// fades at an edge while items pass under it (site.css, docs.css). It starts with the current page in view.
const nav = $('[data-component="sidebar"] > [data-component="section-nav"]')!
function fade() {
  nav.toggleAttribute("data-scrolls", nav.scrollHeight > nav.clientHeight)
  nav.toggleAttribute("data-fade-top", nav.scrollTop > 0)
  nav.toggleAttribute("data-fade-bottom", nav.scrollTop + nav.clientHeight < nav.scrollHeight - 1)
}
const currentPage = $<HTMLElement>('[aria-current="page"]', nav)
if (currentPage && currentPage.offsetTop + currentPage.offsetHeight > nav.clientHeight)
  nav.scrollTop = currentPage.offsetTop - nav.clientHeight / 2
new ResizeObserver(fade).observe(nav)
nav.addEventListener("scroll", fade, { passive: true })

// The Contents rail and its phone bar mark the section being read: the last heading past a third of
// the window, or at the end of the page the one the address names (else the last in view). The rail
// keeps it in view; the phone bar draws its lines once pinned (data-stuck).
const links = $$<HTMLAnchorElement>(":is([data-component=on-this-page], [data-component=contents-menu]) a")
const headings = [...new Set(links.map((link) => decodeURIComponent(link.hash.slice(1))))].flatMap((id) => {
  const heading = document.getElementById(id)
  return heading ? [heading] : []
})
let spied = ""
function spy() {
  const tops = headings.map((heading) => ({ id: heading.id, top: heading.getBoundingClientRect().top }))
  const visible = tops.filter((item) => item.top >= 0 && item.top < innerHeight)
  const bottom = scrollY + innerHeight >= html.scrollHeight - 2
  const end = visible.find((item) => `#${item.id}` === decodeURIComponent(location.hash)) ?? visible.at(-1)
  const id = (bottom && end ? end : tops.filter((item) => item.top <= innerHeight / 3).at(-1))?.id ?? tops[0]?.id
  const contents = $<HTMLElement>("[data-component=contents-menu]")
  if (contents)
    contents.toggleAttribute(
      "data-stuck",
      scrollY > 0 && contents.getBoundingClientRect().top <= parseFloat(getComputedStyle(contents).top) + 0.5,
    )
  if (id === spied) return
  spied = id ?? ""
  links.forEach((link) =>
    decodeURIComponent(link.hash.slice(1)) === id
      ? link.setAttribute("aria-current", "location")
      : link.removeAttribute("aria-current"),
  )
  const link = $("[data-component=on-this-page] [aria-current]")
  const box = link?.closest<HTMLElement>("[data-component=aside] > *")
  if (!link || !box) return
  const item = link.getBoundingClientRect()
  const view = box.getBoundingClientRect()
  if (item.top < view.top) box.scrollTop -= view.top - item.top + 24
  if (item.bottom > view.bottom) box.scrollTop += item.bottom - view.bottom + 24
}
let frame = 0
const schedule = () => {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(spy)
}
addEventListener("scroll", schedule, { passive: true })
addEventListener("resize", schedule, { passive: true })
on("click", (event) => {
  const link = (event.target as Element).closest("[data-component=contents-menu] a")
  const menu = link?.closest("details")
  if (menu) menu.open = false
})

// An address naming an endpoint or schema of the API reference opens its card.
function reveal() {
  const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)))
  const card = target && target.closest("details")
  if (card) card.open = true
  schedule()
}
addEventListener("hashchange", reveal)
reveal()

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
  if (!pages.length) {
    const empty = document.createElement("p")
    empty.dataset.slot = "empty"
    empty.textContent = query ? `No results for “${query}”` : ""
    results.append(empty)
  }
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
  } else if (event.key === "Escape") {
    event.preventDefault()
    void closeSearch()
  } else if (event.key === "Tab") event.preventDefault()
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
// service, then the live status. Kept a minute in sessionStorage, since every docs page is a full load.
type Status = "operational" | "degraded" | "outage" | "unknown"
const statusLabels = { operational: "Normal", degraded: "Degraded", outage: "Outage", unknown: "No data" }
const headlines = {
  operational: "All systems operational",
  degraded: "Degraded performance",
  outage: "Service disruption",
  unknown: "Status unavailable",
}
const rank = { unknown: 0, operational: 1, degraded: 2, outage: 3 }
function showStatus(bars: Status[]) {
  const link = $("[data-component=status]")
  if (!link) return
  const current = bars.at(-1)!
  link.dataset.state = current
  link.title = headlines[current]
  $("[data-slot=status-text]", link)!.textContent = statusLabels[current]
  $$("[data-slot=bars] > span", link).forEach((bar, index) => (bar.dataset.state = bars[index] ?? "unknown"))
}
const saved = JSON.parse(sessionStorage.getItem("docs-status-bars") ?? "null") as { bars: Status[]; at: number } | null
if (saved?.bars?.length === 6) showStatus(saved.bars)
const idle = (run: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(run) : setTimeout(run, 1500))
if (!saved || Date.now() - saved.at > 60_000)
  idle(() =>
    fetch("/status/api/status", { signal: AbortSignal.timeout(10_000) })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body: { status: Status; history: { services: Record<string, Status> }[] }) => {
        const worst = (list: Status[]) => list.reduce<Status>((a, b) => (rank[b] > rank[a] ? b : a), "unknown")
        const bars = [...body.history.slice(-5).map((entry) => worst(Object.values(entry.services))), body.status]
        if (bars.length !== 6 || !bars.every((bar) => bar in rank)) return
        sessionStorage.setItem("docs-status-bars", JSON.stringify({ bars, at: Date.now() }))
        showStatus(bars)
      })
      .catch(() => undefined),
  )
