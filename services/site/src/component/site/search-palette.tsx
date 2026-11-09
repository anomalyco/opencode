import "./search-palette.css"
import { useLocation } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import type { FunnelEvent } from "~/lib/funnel"
import { strip } from "~/lib/language"
import { devicePreviewOpenEvent, inDevicePreview } from "~/lib/platform"
import { siteSettings, type SiteSettings } from "./settings"
import { onCloseMenus } from "./menu-open"
import {
  isSearchShortcut,
  searchOpenEvent,
  setSearchAnnouncement,
  setSearchShown,
  type SearchVia,
  type SiteSearchProps,
} from "./search"
import type { SearchAction, SearchGroup, SearchItem, SearchResult } from "./search-index"

/**
 * The ⌘K dialog, loaded by the search shell (search.tsx) on the first ⌘K, Ctrl+K or "/", or once ⌘
 * or Ctrl is pressed. The index loads with a second dynamic import on first open.
 */

type SearchModule = typeof import("./search-index")
type Row = { result: SearchResult; group: SearchGroup; query?: string }

const recentKey = "opencode-site-search-recent"
const listID = "site-search-listbox"
const optionID = (index: number) => `site-search-option-${index}`
const groupID = (index: number) => `site-search-group-${index}`

// Results that stay English in every locale: release notes, the legal documents, the docs (served by
// the docs app) and the Design mode actions.
function englishOnly(item: { id: string; group: string; href?: string; action?: string }) {
  return (
    item.group === "Changelog" ||
    item.group === "Docs" ||
    item.id.startsWith("legal:") ||
    !!item.href?.includes("/legal/") ||
    // The font page is a type specimen that stays English.
    !!item.href?.endsWith("/font") ||
    item.action === "settings" ||
    item.action === "design" ||
    item.action === "device-preview"
  )
}

export function SearchPalette(props: SiteSearchProps & { openOnMount?: SearchVia }) {
  const i18n = useI18n()
  const language = useLanguage()
  const location = useLocation()
  const [open, setOpen] = createSignal(false)
  const [closing, setClosing] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [active, setActive] = createSignal(0)
  const [search, setSearch] = createSignal<SearchModule>()
  const [items, setItems] = createSignal<SearchItem[]>([])
  const [changelog, setChangelog] = createSignal<SearchItem[]>([])
  const [recent, setRecent] = createSignal<{ items: string[]; queries: string[] }>({ items: [], queries: [] })
  let input: HTMLInputElement | undefined
  let panel: HTMLDivElement | undefined
  let list: HTMLDivElement | undefined
  let opener: HTMLElement | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  // Whether a result was chosen since the search opened, so closing it then isn't a dismissal.
  let chosen = false

  // Spotlight and minimal are one list; the others follow Settings › Search results.
  const grouped = () =>
    siteSettings.searchResults === "grouped" &&
    siteSettings.searchStyle !== "spotlight" &&
    siteSettings.searchStyle !== "minimal"

  const rows = createMemo<Row[]>(() => {
    const module = search()
    if (!module) return []
    // The page inside the device preview can't open a preview of its own.
    const all = [...items(), ...changelog()].filter((item) => item.action !== "device-preview" || !inDevicePreview())
    const text = query().trim()
    if (!text) {
      const byID = new Map(all.map((item) => [item.id, item]))
      const pages = recent()
        .items.map((id) => byID.get(id))
        .filter((item) => item !== undefined)
      const queries = recent().queries.map(
        (value): Row => ({
          result: {
            item: { id: `query:${value}`, group: "Recent", title: value, context: i18n.t("site.search.label") },
            score: 0,
            title: [],
          },
          group: "Recent",
          query: value,
        }),
      )
      const suggestions = all.filter((item) => item.group === "Pages" || item.group === "Actions")
      return [
        ...queries,
        ...pages.map((item): Row => ({ result: { item, score: 0, title: [] }, group: "Recent" })),
        ...suggestions.map((item): Row => ({ result: { item, score: 0, title: [] }, group: item.group })),
      ]
    }
    const results = module.rank(all, text).slice(0, 60)
    if (!grouped()) return results.slice(0, 30).map((result) => ({ result, group: result.item.group }))
    // Groups in the order of their best result, at most eight rows each.
    const order = [...new Set(results.map((result) => result.item.group))]
    return order.flatMap((group) =>
      results
        .filter((result) => result.item.group === group)
        .slice(0, 8)
        .map((result) => ({ result, group })),
    )
  })

  // The rows split where a group header shows: for results in grouped mode, and always over the
  // empty search's suggestions. Each labelled part is a listbox group, so screen readers name it.
  const sections = createMemo(() => {
    const labelled = !query().trim() || grouped()
    return rows().reduce<{ label?: SearchGroup; rows: { row: Row; index: number }[] }[]>((acc, row, index) => {
      const last = acc[acc.length - 1]
      if (last && (!labelled || last.label === row.group)) last.rows.push({ row, index })
      else acc.push({ label: labelled ? row.group : undefined, rows: [{ row, index }] })
      return acc
    }, [])
  })

  const look = createMemo(() => searchLook(siteSettings))

  createEffect(() => {
    void rows()
    setActive(0)
  })

  createEffect(() => {
    if (!open()) return
    const count = rows().length
    setSearchAnnouncement(
      query().trim()
        ? count === 0
          ? i18n.t("site.search.noResults")
          : count === 1
            ? i18n.t("site.search.result")
            : i18n.t("site.search.results", { count })
        : "",
    )
  })

  const index = async () => {
    const module = search() ?? (await import("./search-index"))
    if (!search()) {
      setItems(module.buildSearchIndex(i18n.t, language.route, language.locale(), !!props.onDesign))
      setSearch(module)
    }
    return module
  }

  const load = async () => {
    const module = await index()
    // Releases come from GitHub through the changelog's JSON; tried again on each open until they load.
    if (changelog().length > 0) return
    void fetch("/changelog.json")
      .then((response) => response.json())
      .then((data: { releases?: Parameters<SearchModule["changelogItems"]>[0] }) =>
        setChangelog(module.changelogItems(data.releases ?? [], language.route)),
      )
      .catch(() => undefined)
  }

  // How many results showed for how many characters; never what was typed.
  const searched = () => ({ results: rows().length, query_len: query().trim().length })

  const show = (via: SearchVia) => {
    if (open() && !closing()) return
    report({ name: "search.opened", action: "opened", target: via, properties: { kind: "site" } })
    chosen = false
    clearTimeout(closeTimer)
    setClosing(false)
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    setRecent(readRecent())
    setQuery("")
    setOpen(true)
    setSearchShown(true)
    void load()
    queueMicrotask(() => input?.focus())
  }

  const close = (restore = true) => {
    if (!open() || closing()) return
    if (!chosen) report({ name: "search.closed", action: "dismissed", target: "", properties: searched() })
    const instant = siteSettings.searchMotion === "none" || matchMedia("(prefers-reduced-motion: reduce)").matches
    const finish = () => {
      setOpen(false)
      setClosing(false)
    }
    // Closing first, so the focus trap lets focus go back.
    setClosing(true)
    setSearchShown(false)
    if (restore && opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true })
    // Nothing had focus before: leave the field, so "/" opens the search again at once.
    if (restore && (!opener?.isConnected || opener === document.body)) input?.blur()
    if (instant) return finish()
    closeTimer = setTimeout(finish, 120)
  }

  const remember = (item: SearchItem, text: string) => {
    const current = readRecent()
    const next = {
      items:
        item.group === "Recent"
          ? current.items
          : [item.id, ...current.items.filter((id) => id !== item.id)].slice(0, 5),
      queries: text ? [text, ...current.queries.filter((value) => value !== text)].slice(0, 3) : current.queries,
    }
    localStorage.setItem(recentKey, JSON.stringify(next))
  }

  const run = (row: Row, newTab: boolean) => {
    if (row.query) {
      setQuery(row.query)
      input?.focus()
      return
    }
    const item = row.result.item
    chosen = true
    report({
      name: "search.selected",
      action: "selected",
      target: resultTarget(item),
      properties: { rank: rows().indexOf(row) + 1, ...searched() },
    })
    remember(item, query().trim())
    if (item.action && item.action !== "brand-assets") return act(item.action)
    if (!item.href) return
    const url = new URL(item.href, window.location.origin)
    if (newTab || url.origin !== window.location.origin) {
      window.open(url.href, "_blank", "noopener")
      if (!newTab) close()
      return
    }
    if (item.action === "brand-assets") {
      close()
      const link = Object.assign(document.createElement("a"), {
        href: item.href,
        download: "opencode-brand-assets.zip",
      })
      link.click()
      return
    }
    close(false)
    const path = trim(url.pathname)
    if (path !== trim(window.location.pathname)) props.go(url.pathname)
    reveal(path, item.target)
  }

  // A navigation that didn't come from the palette (Back, a link behind it) closes it too.
  onCloseMenus(() => close(false))

  const act = (action: SearchAction) => {
    close(action !== "settings" && action !== "design" && action !== "device-preview")
    if (action === "theme") return props.onToggleTheme()
    if (action === "device-preview") return document.dispatchEvent(new Event(devicePreviewOpenEvent))
    if (action === "settings") return props.onSettings?.()
    if (action === "design") return props.onDesign?.()
    if (action === "brand-rules") {
      const module = search()
      if (!module) return
      void navigator.clipboard.writeText(module.brandRules(i18n.t, language.route)).then(
        () => setSearchAnnouncement(i18n.t("site.search.rulesCopied")),
        () => setSearchAnnouncement(i18n.t("site.search.rulesFailed")),
      )
    }
  }

  const move = (delta: number) => {
    const count = rows().length
    if (count === 0) return
    setActive((index) => (index + delta + count) % count)
  }

  // Page Up and Page Down step a screenful of rows without wrapping.
  const page = (direction: 1 | -1) => {
    const count = rows().length
    if (count === 0) return
    setActive((index) => Math.min(count - 1, Math.max(0, index + direction * 8)))
  }

  // Tab and Shift+Tab jump to the first row of the next or previous group.
  const jumpGroup = (direction: 1 | -1) => {
    const starts = rows()
      .map((row, index) => (index === 0 || rows()[index - 1].group !== row.group ? index : -1))
      .filter((index) => index >= 0)
    if (starts.length < 2) return
    const current = starts.findLastIndex((start) => start <= active())
    setActive(starts[(current + direction + starts.length) % starts.length])
  }

  const keys = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      return close()
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      // ⌘↑ and ⌘↓ (Ctrl on other systems) go to the first and last result.
      if (event.metaKey || event.ctrlKey)
        return setActive(event.key === "ArrowDown" ? Math.max(rows().length - 1, 0) : 0)
      return move(event.key === "ArrowDown" ? 1 : -1)
    }
    // Home and End move the caret in the field, as in any text field; with Ctrl or ⌘ they go to the
    // first and last result.
    if ((event.key === "Home" || event.key === "End") && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      return setActive(event.key === "End" ? Math.max(rows().length - 1, 0) : 0)
    }
    if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault()
      return page(event.key === "PageDown" ? 1 : -1)
    }
    if (event.key === "Tab") {
      event.preventDefault()
      return jumpGroup(event.shiftKey ? -1 : 1)
    }
    if (event.key === "Enter" && !event.isComposing) {
      const newTab = event.metaKey || event.ctrlKey
      // Typed and entered before the index arrived: run the top result once it has.
      if (!search()) {
        event.preventDefault()
        void load().then(() => {
          const row = rows()[active()]
          if (row && open() && !closing()) run(row, newTab)
        })
        return
      }
      const row = rows()[active()]
      if (!row) return
      event.preventDefault()
      run(row, newTab)
    }
  }

  createEffect(() => {
    const index = active()
    if (!open()) return
    requestAnimationFrame(() => list?.querySelector(`#${optionID(index)}`)?.scrollIntoView({ block: "nearest" }))
  })

  // Lock the page behind the open search. The stable gutter keeps the page from shifting sideways
  // where scrollbars take space (Windows, Linux).
  createEffect(() => {
    if (!open()) return
    const style = document.documentElement.style
    const previous = { overflow: style.overflow, gutter: style.scrollbarGutter }
    style.scrollbarGutter = "stable"
    style.overflow = "hidden"
    onCleanup(() => {
      style.overflow = previous.overflow
      style.scrollbarGutter = previous.gutter
    })
  })

  onMount(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event)) return
      event.preventDefault()
      if (event.key !== "/" && open() && !closing()) return close()
      show(event.key === "/" ? "slash" : "shortcut")
    }
    const showFromButton = () => show("button")
    // Focus stays in the dialog, except for Design mode's controls and the Settings panel, which
    // tune it live (Settings › Search › Preview opens it under the panel).
    const trap = (event: FocusEvent) => {
      if (!open() || closing() || !panel) return
      const target = event.target as Element
      if (panel.contains(target)) return
      if (
        import.meta.env.DEV &&
        target.closest?.('[data-component="design-controls"], [data-component="settings-panel"]')
      )
        return
      input?.focus()
    }
    document.addEventListener("keydown", shortcut)
    document.addEventListener("focusin", trap)
    document.addEventListener(searchOpenEvent, showFromButton)
    if (props.openOnMount) show(props.openOnMount)
    // Mounted ahead of the first open (⌘ or Ctrl pressed): build the index in the next idle period,
    // so the first ⌘K shows results at once.
    const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 500))
    if (!props.openOnMount) idle(() => void index())
    onCleanup(() => {
      setSearchShown(false)
      clearTimeout(closeTimer)
      document.removeEventListener("keydown", shortcut)
      document.removeEventListener("focusin", trap)
      document.removeEventListener(searchOpenEvent, showFromButton)
    })
  })

  // Close when the page changes underneath (a link, the back button).
  createEffect(
    on(
      () => location.pathname,
      () => close(false),
      { defer: true },
    ),
  )

  const current = (item: SearchItem) =>
    item.group === "Pages" &&
    !!item.href &&
    trim(new URL(item.href, "https://opencode.ai").pathname) === trim(location.pathname)

  return (
    <Show when={open()}>
      <div
        data-component="site-search"
        data-style={siteSettings.searchStyle}
        data-backdrop={siteSettings.searchBackdrop}
        data-tint={siteSettings.searchTint}
        data-motion={siteSettings.searchMotion}
        style={look()}
        data-closing={closing() ? "" : undefined}
      >
        <div data-slot="backdrop" aria-hidden="true" onClick={() => close()} />
        <div
          ref={panel}
          data-slot="panel"
          data-design="searchStyle searchBackdrop searchMotion searchResults searchHint searchBlur searchDimLight searchDimDark searchTint searchSaturate searchBrightness searchPanelOpacity searchPanelBlur searchShadow"
          role="dialog"
          aria-modal="true"
          aria-label={i18n.t("site.search.dialog")}
          on:keydown={keys}
        >
          <div data-slot="field">
            <svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle
                cx="7.43"
                cy="7.43"
                r="5.06"
                stroke="currentColor"
                stroke-width="1.5"
                vector-effect="non-scaling-stroke"
              />
              <path
                d="M11 11L13.33 13.33"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="square"
                vector-effect="non-scaling-stroke"
              />
            </svg>
            <input
              ref={input}
              type="search"
              role="combobox"
              aria-expanded="true"
              aria-haspopup="listbox"
              aria-controls={listID}
              aria-autocomplete="list"
              aria-activedescendant={rows().length ? optionID(active()) : undefined}
              aria-label={i18n.t("site.search.label")}
              placeholder={i18n.t("site.search.placeholder")}
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              enterkeyhint="go"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
            {/* Named by what it shows: "Close search" beside the Esc key cap, "Cancel" on phones. */}
            <button type="button" data-slot="close" tabIndex={-1} onClick={() => close()}>
              <span data-slot="esc">
                <span aria-hidden="true">Esc</span>
                <span data-slot="sr-only">{i18n.t("site.search.close")}</span>
              </span>
              <span data-slot="cancel">{i18n.t("common.cancel")}</span>
            </button>
          </div>
          <div
            ref={list}
            data-slot="results"
            id={listID}
            role="listbox"
            aria-label={i18n.t("site.search.resultsLabel")}
          >
            <Show when={search()} fallback={<p data-slot="empty">{i18n.t("site.search.loading")}</p>}>
              <Show
                when={rows().length > 0}
                fallback={
                  <p data-slot="empty">
                    {query().trim() ? i18n.t("site.search.noResultsFor", { query: query().trim() }) : ""}
                  </p>
                }
              >
                <For each={sections()}>
                  {(section, part) => (
                    <div
                      role={section.label ? "group" : "none"}
                      aria-labelledby={section.label ? groupID(part()) : undefined}
                      data-slot="section"
                    >
                      <Show when={section.label}>
                        {(label) => (
                          <div data-slot="group" id={groupID(part())} role="presentation">
                            {i18n.t(`site.search.group.${label()}`)}
                          </div>
                        )}
                      </Show>
                      <For each={section.rows}>
                        {({ row, index }) => (
                          <div
                            id={optionID(index)}
                            role="option"
                            data-slot="option"
                            lang={englishOnly(row.result.item) ? "en" : undefined}
                            aria-selected={active() === index ? "true" : "false"}
                            data-active={active() === index ? "" : undefined}
                            aria-current={current(row.result.item) ? "page" : undefined}
                            onPointerMove={() => active() !== index && setActive(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={(event) => run(row, event.metaKey || event.ctrlKey)}
                          >
                            <span data-slot="text">
                              <span data-slot="title">
                                <Highlight text={row.result.item.title} ranges={row.result.title} />
                              </span>
                              <Show when={row.result.snippet}>
                                {(snippet) => (
                                  <span data-slot="snippet">
                                    <Highlight text={snippet().text} ranges={snippet().ranges} />
                                  </span>
                                )}
                              </Show>
                            </span>
                            <Show when={row.result.item.context}>
                              {(context) =>
                                // Shortcuts ("⇧P") read left to right in every language; paths and
                                // versions follow their own text.
                                /^[⇧⌘⌥⌃]/.test(context()) ? (
                                  <kbd data-slot="context" dir="ltr">
                                    {context()}
                                  </kbd>
                                ) : (
                                  <span data-slot="context" dir="auto">
                                    {context()}
                                  </span>
                                )
                              }
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}

/**
 * The look settings as custom properties on the search root (search-palette.css). A see-through
 * panel also tones the page behind it into a narrow band next to the panel colour, so the panel stays
 * at least 97% white (dark: at most 12%) over any page, which keeps its text at 4.5:1 or more.
 */
export function searchLook(s: SiteSettings) {
  const alpha = s.searchPanelOpacity / 100
  const blur = alpha < 1 && s.searchPanelBlur > 0 ? `blur(${s.searchPanelBlur}px)` : ""
  // Light: map the page's 0–1 onto lo–1 with contrast(c) then brightness(b), in sRGB like compositing.
  const lo = (0.97 - alpha) / (1 - alpha)
  const c = (1 - lo) / (1 + lo)
  const light = alpha < 0.97 ? `contrast(${c.toFixed(4)}) brightness(${(2 / (1 + c)).toFixed(4)})` : ""
  // Dark: scale the page's 0–1 down to 0–hi; the dark panel is 10% white.
  const hi = alpha < 1 ? (0.12 - 0.1 * alpha) / (1 - alpha) : 1
  const dark = hi < 1 ? `brightness(${hi.toFixed(4)})` : ""
  const backdrop = [
    s.searchBlur > 0 ? `blur(${s.searchBlur}px)` : "",
    s.searchSaturate !== 100 ? `saturate(${s.searchSaturate}%)` : "",
    s.searchBrightness !== 100 ? `brightness(${s.searchBrightness}%)` : "",
  ].join(" ")
  return {
    "--search-dim-light": `${s.searchDimLight}%`,
    "--search-dim-dark": `${s.searchDimDark}%`,
    "--search-backdrop-filter": backdrop.trim() || "none",
    "--search-panel-alpha": `${s.searchPanelOpacity}%`,
    "--search-panel-filter-light": `${blur} ${light}`.trim() || "none",
    "--search-panel-filter-dark": `${blur} ${dark}`.trim() || "none",
    "--search-shadow": String(s.searchShadow / 100),
  }
}

function Highlight(props: { text: string; ranges: [number, number][] }) {
  const parts = () =>
    props.ranges.reduce<{ text: string; mark: boolean }[]>((acc, range, index) => {
      const start = index === 0 ? 0 : props.ranges[index - 1][1]
      if (range[0] > start) acc.push({ text: props.text.slice(start, range[0]), mark: false })
      acc.push({ text: props.text.slice(range[0], range[1]), mark: true })
      if (index === props.ranges.length - 1 && range[1] < props.text.length)
        acc.push({ text: props.text.slice(range[1]), mark: false })
      return acc
    }, [])
  return (
    <Show when={props.ranges.length > 0} fallback={props.text}>
      <For each={parts()}>{(part) => (part.mark ? <mark>{part.text}</mark> : part.text)}</For>
    </Show>
  )
}

/**
 * Scrolls to a search result's place once its page is showing: an element ID, a heading with the
 * result's text, or a FAQ question (opened). Pages fade in after in-place navigation, so this waits
 * for the path and the element for up to three seconds.
 */
function reveal(path: string, target: SearchItem["target"]) {
  const started = performance.now()
  const step = () => {
    const ready = trim(window.location.pathname) === path
    const element = ready ? find(target) : undefined
    if (!element) {
      if (performance.now() - started < 3000) requestAnimationFrame(step)
      return
    }
    const trigger = target?.faq ? element.querySelector<HTMLElement>('[data-slot="faq-question"]') : undefined
    if (trigger && trigger.getAttribute("aria-expanded") !== "true") trigger.click()
    const bar = document.querySelector('[data-component="topbar"]')?.getBoundingClientRect()
    // The small-screen header is sticky, so the target lands below it.
    const offset = (bar && bar.height > 0 ? Math.max(bar.bottom, 0) : 0) + 24
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches
    window.scrollTo({
      top: element.getBoundingClientRect().top + window.scrollY - offset,
      behavior: reduce ? "instant" : "smooth",
    })
    const focusable = trigger ?? element
    if (!trigger && !element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1")
    focusable.focus({ preventScroll: true })
    element.setAttribute("data-search-target", "")
    setTimeout(() => element.removeAttribute("data-search-target"), 1600)
  }
  if (!target) return window.scrollTo({ top: 0 })
  requestAnimationFrame(step)
}

function find(target: SearchItem["target"]): HTMLElement | undefined {
  if (!target) return
  const content = document.querySelector('[data-component="content"]') ?? document
  if (target.id) return document.getElementById(target.id) ?? undefined
  if (target.faq)
    return (
      [...content.querySelectorAll<HTMLElement>('[data-slot="faq-item"]')].find(
        (item) => item.querySelector('[data-slot="faq-question-text"]')?.textContent?.trim() === target.faq,
      ) ?? undefined
    )
  const text = target.text?.trim().toLowerCase()
  return (
    [...content.querySelectorAll<HTMLElement>("h1, h2, h3, h4, strong, dt")].find(
      (element) => element.textContent?.trim().toLowerCase() === text && element.getClientRects().length > 0,
    ) ?? undefined
  )
}

/** A chosen result for the funnel: the page it opens, without its language (`link:/desktop`), or the action it runs. */
function resultTarget(item: SearchItem) {
  if (item.action && item.action !== "brand-assets") return `action:${item.action}`
  const url = new URL(item.href ?? "/", window.location.origin)
  const target = url.origin === window.location.origin ? `link:${strip(url.pathname)}` : `outbound:${url.hostname}`
  return target.replace(/[^A-Za-z0-9/_.:+-]+/g, "-").slice(0, 96)
}

/** Reports a search event to the funnel (lib/funnel.ts), through its queue. */
function report(event: FunnelEvent) {
  window.__ocFunnel?.push({ event, at: performance.now() })
}

function trim(path: string) {
  return path.length > 1 ? path.replace(/\/$/, "") : path
}

function readRecent(): { items: string[]; queries: string[] } {
  try {
    const value = JSON.parse(localStorage.getItem(recentKey) ?? "null")
    return {
      items: Array.isArray(value?.items) ? value.items.filter((item: unknown) => typeof item === "string") : [],
      queries: Array.isArray(value?.queries) ? value.queries.filter((item: unknown) => typeof item === "string") : [],
    }
  } catch {
    return { items: [], queries: [] }
  }
}
