// The docs pages' only script: search, copy buttons, tabs, the status link and the funnel. Pages are
// plain HTML (no hydration); everything here is delegated from the document, so it needs no
// per-element setup. The theme toggle is in the layout's head script, so it works before this loads.
import { Funnel } from "../../lib/funnel"
import { downloadOf, surfaceOf, targetOf } from "../../lib/funnel-config"

// The page reports to the Console's funnel like the site's (lib/funnel.ts). The docs are English, at the host's root
// like the site; their config is built in, as a chunk would bring Vite's preload helper with it.
Funnel.start(async () => ({ surfaceOf, targetOf, localeOf: () => "en", base: "", downloadOf }))

type PagefindResult = { url: string; excerpt: string; meta: { title: string } }
type Pagefind = { search(query: string): Promise<{ results: { data(): Promise<PagefindResult> }[] }> }

let pagefind: Promise<Pagefind> | undefined
// Pagefind is loaded from its built file on first search. Through `Function` because Vite would wrap
// a plain import() in its preload helper, a second script on every page for a file it can't preload.
const load = new Function("url", "return import(url)") as (url: string) => Promise<Pagefind>
const dialog = document.querySelector<HTMLDialogElement>("[data-search-dialog]")
const input = document.querySelector<HTMLInputElement>("[data-search-input]")
const results = document.querySelector<HTMLElement>("[data-search-results]")
// Whether a result was chosen since the search opened, so closing it then isn't a dismissal.
let chosen = false

function openSearch(via: "shortcut" | "button") {
  if (dialog && !dialog.open)
    Funnel.track({ name: "search.opened", action: "opened", target: via, properties: { kind: "docs" } })
  chosen = false
  dialog?.showModal()
  input?.focus()
}

// How many results showed for how many characters; never what was typed.
const searched = () => ({
  results: results?.querySelectorAll("a").length ?? 0,
  query_len: input?.value.trim().length ?? 0,
})

dialog?.addEventListener("close", () => {
  if (!chosen) Funnel.track({ name: "search.closed", action: "dismissed", target: "", properties: searched() })
})

// A chosen result, captured on the window so it's reported before the tracker's own report of the click sends what's
// waiting as the result's page loads.
window.addEventListener(
  "click",
  (event) => {
    const result = event.target instanceof Element && event.target.closest<HTMLAnchorElement>("[data-search-results] a")
    if (!result) return
    chosen = true
    const target = `link:${new URL(result.href).pathname}`.replace(/[^A-Za-z0-9/_.:+-]+/g, "-").slice(0, 96)
    const rank = [...(results?.querySelectorAll("a") ?? [])].indexOf(result) + 1
    Funnel.track({ name: "search.selected", action: "selected", target, properties: { rank, ...searched() } })
  },
  true,
)

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault()
    openSearch("shortcut")
  }
})

input?.addEventListener("input", async () => {
  if (!dialog || !results) return
  const query = input.value.trim()
  if (!query) {
    results.innerHTML = "<p>Start typing to search the documentation.</p>"
    return
  }
  const path = dialog.dataset.pagefindPath
  if (!path) return
  pagefind ??= load(path)
  const search = await (await pagefind).search(query)
  const pages = await Promise.all(search.results.slice(0, 8).map((result) => result.data()))
  const base = dialog.dataset.baseUrl ?? "/"
  results.replaceChildren(
    ...pages.map((page) => {
      const link = document.createElement("a")
      link.href = page.url.startsWith(base) ? page.url : `${base.replace(/\/$/, "")}${page.url}`
      const title = document.createElement("strong")
      title.textContent = page.meta.title
      const excerpt = document.createElement("span")
      excerpt.innerHTML = page.excerpt
      link.append(title, excerpt)
      return link
    }),
  )
  if (!pages.length) results.innerHTML = "<p>No results found.</p>"
})

document.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) return
  if (event.target.closest("[data-search-open]")) return openSearch("button")

  const code = event.target.closest<HTMLButtonElement>("[data-copy-code]")
  if (code) {
    await navigator.clipboard.writeText(code.dataset.code ?? "")
    code.textContent = "Copied"
    window.setTimeout(() => (code.textContent = "Copy"), 1500)
    return
  }

  const tab = event.target.closest<HTMLButtonElement>("[data-code-tab]")
  if (tab) return selectCodeTab(tab)

  const plan = event.target.closest<HTMLButtonElement>("[data-plan-tab]")
  const plans = plan?.closest<HTMLElement>("[data-plan-tabs]")
  if (plan?.dataset.planTab && plans) return selectSyncedPlan(plans, plan.dataset.planTab)

  const markdown = event.target.closest<HTMLButtonElement>("[data-copy-markdown]")
  if (markdown) {
    markdown.dataset.copied = "true"
    markdown.setAttribute("aria-label", "Copied")
    window.setTimeout(() => {
      delete markdown.dataset.copied
      markdown.setAttribute("aria-label", "Copy page as Markdown")
    }, 1500)
    const response = await fetch(window.location.href, { headers: { Accept: "text/markdown" } })
    if (!response.ok) return
    await navigator.clipboard.writeText(await response.text())
  }
})

// Arrow keys, Home and End move between tabs.
document.addEventListener("keydown", (event) => {
  if (!(event.target instanceof HTMLButtonElement)) return
  const tabs = event.target.closest<HTMLElement>("[data-code-tabs], [data-plan-tabs]")
  if (!tabs || !event.target.matches("[data-code-tab], [data-plan-tab]")) return
  const buttons = [...tabs.querySelectorAll<HTMLButtonElement>("[data-code-tab], [data-plan-tab]")]
  const selected = buttons.indexOf(event.target)
  const next =
    event.key === "Home"
      ? buttons[0]
      : event.key === "End"
        ? buttons.at(-1)
        : event.key === "ArrowRight"
          ? buttons[(selected + 1) % buttons.length]
          : event.key === "ArrowLeft"
            ? buttons[(selected - 1 + buttons.length) % buttons.length]
            : undefined
  if (!next) return
  event.preventDefault()
  if (next.dataset.planTab) selectSyncedPlan(tabs, next.dataset.planTab)
  else selectCodeTab(next)
  next.focus()
})

function selectCodeTab(button: HTMLButtonElement) {
  const tabs = button.closest<HTMLElement>("[data-code-tabs]")
  if (!tabs) return
  const buttons = [...tabs.querySelectorAll<HTMLButtonElement>("[data-code-tab]")]
  const selected = buttons.indexOf(button)
  buttons.forEach((item, index) => {
    item.setAttribute("aria-selected", String(index === selected))
    item.tabIndex = index === selected ? 0 : -1
  })
  tabs.querySelectorAll<HTMLElement>("[data-code-panel]").forEach((panel, index) => (panel.hidden = index !== selected))
}

function selectPlan(tabs: HTMLElement, plan: string) {
  tabs.querySelectorAll<HTMLButtonElement>("[data-plan-tab]").forEach((button) => {
    const selected = button.dataset.planTab === plan
    button.setAttribute("aria-selected", String(selected))
    button.tabIndex = selected ? 0 : -1
  })
  tabs.querySelectorAll<HTMLElement>("[data-plan-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.planPanel !== plan
  })
}

// Plan tabs with the same sync key switch together, and the choice is remembered.
function selectSyncedPlan(source: HTMLElement, plan: string) {
  const syncKey = source.dataset.syncKey
  if (!syncKey) return
  document.querySelectorAll<HTMLElement>("[data-plan-tabs]").forEach((tabs) => {
    if (tabs.dataset.syncKey === syncKey) selectPlan(tabs, plan)
  })
  localStorage.setItem(`docs-plan-tabs:${syncKey}`, plan)
}

document.querySelectorAll<HTMLElement>("[data-plan-tabs]").forEach((tabs) => {
  const plan = tabs.dataset.syncKey && localStorage.getItem(`docs-plan-tabs:${tabs.dataset.syncKey}`)
  if (plan) selectPlan(tabs, plan)
})

// The status page's summary. Each page is a full load, so the last answer is kept for a minute in
// sessionStorage: the next page shows it at once instead of fetching again.
const labels = {
  operational: "All systems operational",
  degraded: "Degraded performance",
  outage: "Service disruption",
}
type Status = keyof typeof labels

function showStatus(status: Status) {
  const link = document.querySelector<HTMLAnchorElement>(".system-status")
  if (!link) return
  link.dataset.status = status
  link.textContent = labels[status]
}

const cached = (() => {
  const value = JSON.parse(sessionStorage.getItem("docs-status") ?? "null") as { status: Status; at: number } | null
  return value && value.status in labels ? value : undefined
})()
if (cached) showStatus(cached.status)
if (!cached || Date.now() - cached.at > 60_000)
  fetch("/status/api/summary", { signal: AbortSignal.timeout(10_000) })
    .then((response) => (response.ok ? response.json() : undefined))
    .then((body: unknown) => {
      const status = body && typeof body === "object" && "status" in body ? body.status : undefined
      if (status !== "operational" && status !== "degraded" && status !== "outage") return
      sessionStorage.setItem("docs-status", JSON.stringify({ status, at: Date.now() }))
      showStatus(status)
    })
    .catch(() => undefined)
