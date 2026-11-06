import { Link, Meta, Title } from "@solidjs/meta"
import { useSearchParams } from "@solidjs/router"
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import { config } from "~/config"
import { LocaleLinks } from "~/component/locale-links"
import { ShareMeta } from "~/component/share-meta"
import { ogImage } from "~/lib/og"
import { breadcrumbData, JsonLd } from "~/component/structured-data"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import {
  legalDate,
  legalHubMarkdown,
  legalMarkdown,
  legalPages,
  legalTextChanged,
  legalVersions,
  type LegalDocumentContent,
  published,
  type LegalNode,
} from "~/lib/legal"
import { legalSummaries } from "~/lib/legal/summaries"
import { CheckIcon, Chevron, CopyIcon, DownloadIcon, ExternalArrow, NewTab } from "./icons"
import { copySelection } from "~/lib/clipboard"
import { architectLabelCases, architectRules, legalHistoryViews, legalPrintStyles, siteSettings } from "./settings"
import { resolvePattern } from "~/lib/legal/cover-pattern"
import { LegalPrint, LegalReferences, legalReferences, useLegalReference } from "./legal-print"
import {
  architectLayout,
  coverConcepts,
  interiorConcepts,
  layoutKey,
  savedLayout,
  type ArchitectLayout,
} from "~/lib/legal/architect"
import { ContentsMenu, HeadingLink, OnThisPage, SectionHeading, slug } from "./on-this-page"
import { Site } from "./site"
import { useMarkdown } from "./use-markdown"
import { PageTitle } from "./sticky-title"

const feed = "/legal/feed.xml"
const feedTitle = "OpenCode legal updates"

/**
 * A legal document in the docs-style layout: the document in the center and a right sidebar with
 * every legal document and the document's sections. Above the text: the dates, History, Save as
 * PDF and a plain-language summary. Settings › Legal history (or `?historyView=` for review links)
 * picks where History shows: inline above the text, or in place of it (tabs, a toggle, the Contents
 * rail), or in a side drawer.
 */
export function LegalDocument(props: { document: LegalDocumentContent }) {
  const i18n = useI18n()
  const language = useLanguage()
  const [params] = useSearchParams<{
    historyView?: string
    print?: string
    cover?: string
    interior?: string
    rule?: string
    labels?: string
    pattern?: string
    layout?: string
    autoprint?: string
  }>()
  const reviewParams = ["historyView", "print", "cover", "interior", "rule", "labels", "pattern", "layout"] as const
  // Settings › Legal print, or ?print=<style> for previews and PDFs.
  const printStyle = () => legalPrintStyles.find((item) => item === params.print) ?? siteSettings.legalPrintStyle
  const references = legalReferences(props.document.body, language.route)
  // The architect style's layout: ?cover= / ?interior= (previews), else the layout saved in the
  // layout editor, else the concepts in Settings.
  const [customLayout, setCustomLayout] = createSignal<ArchitectLayout>()
  const architect = () => {
    const cover = coverConcepts.find((item) => item === params.cover)
    const interior = interiorConcepts.find((item) => item === params.interior)
    if (!cover && !interior && params.layout !== "concept" && customLayout()) return customLayout()
    return architectLayout(cover ?? siteSettings.architectCover, interior ?? siteSettings.architectInterior)
  }
  // The architect style's dividers: ?rule= (previews), else Settings › Architect dividers.
  const divider = () => architectRules.find((item) => item === params.rule) ?? siteSettings.architectRule
  // The architect style's label case: ?labels= (previews), else Settings › Architect labels.
  // The architect cover's pattern: ?pattern= (an id, or a playground state as JSON), else Settings › Architect pattern.
  const pattern = () => {
    const chosen = resolvePattern(params.pattern) ?? resolvePattern(siteSettings.architectPattern)
    return chosen === "grid" ? undefined : chosen
  }
  const labelCase = () => architectLabelCases.find((item) => item === params.labels) ?? siteSettings.architectLabelCase
  const markdown = useMarkdown(props.document.path, (context) => legalMarkdown(props.document, context))
  const versions = legalVersions(props.document.path)
  const summary = legalSummaries[props.document.path]
  const sections = legalSections(props.document.body)
  const changed = legalTextChanged(props.document)
  const view = () => legalHistoryViews.find((item) => item === params.historyView) ?? siteSettings.legalHistoryView
  // Inline: the panel is expanded. Tabs, toggle and contents: History replaces the text. Drawer: open.
  const [historyOpen, setHistoryOpen] = createSignal(false)
  const swaps = () => view() === "tabs" || view() === "toggle" || view() === "contents"
  const showingHistory = () => historyOpen() && swaps()
  let drawer: HTMLDialogElement | undefined
  let hero: HTMLElement | undefined
  let tabs: HTMLDivElement | undefined

  /**
   * Switches History in or out without moving the page. With the tab bar pinned, the page scrolls
   * so the bar stays pinned and the new view starts at its top under it; otherwise it stays put.
   * The other swapped views start at their top, under the title.
   */
  const showHistory = (open: boolean) => {
    if (open === historyOpen()) return
    const pinned = tabs ? pinnedScroll(tabs) : undefined
    setHistoryOpen(open)
    if (pinned !== undefined) return window.scrollTo({ top: pinned, behavior: "instant" })
    if (!tabs && swaps() && hero && hero.getBoundingClientRect().bottom < 0) window.scrollTo({ top: 0 })
  }

  // Every view but inline puts #history in the address (no navigation), so History is linkable and Back returns.
  const openHistory = (open: boolean) => {
    if (open === historyOpen()) return
    showHistory(open)
    if (view() === "inline") return
    if (open) window.history.pushState(window.history.state, "", "#history")
    if (!open && inHistory(location.hash))
      window.history.pushState(window.history.state, "", location.pathname + location.search)
  }

  onMount(() => {
    setCustomLayout(savedLayout())
    const reload = (event: StorageEvent) => event.key === layoutKey && setCustomLayout(savedLayout())
    window.addEventListener("storage", reload)
    onCleanup(() => window.removeEventListener("storage", reload))
    // "Print preview" in the layout editor opens the page with ?autoprint=1.
    if (params.autoprint === "1") void document.fonts.ready.then(() => setTimeout(() => window.print(), 800))
    // History's own anchors (#history, a version, what changed) keep it open: a Contents link to a
    // version is a fragment navigation, which fires popstate too.
    setHistoryOpen(inHistory(location.hash))
    const sync = () => showHistory(inHistory(location.hash))
    window.addEventListener("popstate", sync)
    onCleanup(() => {
      window.removeEventListener("popstate", sync)
    })
  })

  // The drawer is a modal dialog: Esc, the backdrop and focus all come with it.
  createEffect(() => {
    // Read before the early return, so the effect tracks them even while the drawer isn't rendered yet.
    const open = historyOpen() && view() === "drawer"
    if (!drawer) return
    if (open && !drawer.open) drawer.showModal()
    if (!open && drawer.open) drawer.close()
  })

  // The toggle crossfades the view it swaps in.
  createEffect(
    on(
      showingHistory,
      () => {
        if (view() !== "toggle" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
        document
          .querySelector<HTMLElement>(
            "[data-slot='history-view']:not([hidden]), [data-component='legal-body']:not([hidden])",
          )
          ?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" })
      },
      { defer: true },
    ),
  )

  // In a swapped History, Contents lists the history; "contents" also switches from the rail.
  const historyItems = [
    ...(versions[0] && !versions[0].first ? [{ id: "history-changes", title: "What changed" }] : []),
    ...versions.map((version) => ({ id: `version-${version.sha.slice(0, 7)}`, title: legalDate(version.date) })),
  ]
  // Created once: Site reads its aside more than once, and a fresh element each time breaks hydration.
  const aside =
    sections.length > 1 || versions.length > 0 ? (
      <div data-component="legal-rail" data-design="legalHistoryView" lang="en" dir="ltr">
        <Show when={showingHistory()} fallback={sections.length > 1 ? <OnThisPage items={sections} /> : undefined}>
          <OnThisPage items={historyItems} />
        </Show>
      </div>
    ) : undefined

  const history = (back?: boolean) => (
    <LegalHistory document={props.document} onBack={back ? () => openHistory(false) : undefined} />
  )

  return (
    <Site page="legal-document" aside={aside} markdown={markdown}>
      <LegalPrint
        style={printStyle()}
        part="cover"
        layout={architect()}
        divider={divider()}
        labelCase={labelCase()}
        pattern={pattern()}
        patternId={params.pattern ? "custom" : siteSettings.architectPattern}
        document={props.document}
        sections={sections}
        references={references}
      />
      <Title>{props.document.metaTitle}</Title>
      <ShareMeta
        title={props.document.metaTitle}
        description={props.document.description}
        image={ogImage(props.document.path)}
        englishOnly
      />
      <LocaleLinks path={props.document.path} englishOnly />
      <Meta name="description" content={props.document.description} />
      {/* Drafts, and the review and print links (History views, print styles, layouts). */}
      <Show when={props.document.draft || reviewParams.some((key) => params[key])}>
        <Meta name="robots" content="noindex, nofollow" />
      </Show>
      <Link rel="alternate" type="application/rss+xml" title={feedTitle} href={feed} />
      {/* The legal pages are English at every locale URL, so the trail uses their English URLs. */}
      <JsonLd
        data={breadcrumbData([
          { name: "Home", path: "/" },
          { name: "Legal", path: "/legal" },
          { name: props.document.title, path: props.document.path },
        ])}
      />
      <nav data-component="breadcrumb" aria-label={i18n.t("site.breadcrumb")}>
        <a href={language.route("/legal")}>{i18n.t("site.footer.legal")}</a>
        <span aria-hidden="true">|</span>
        <span aria-current="page" lang="en">
          {props.document.title}
        </span>
      </nav>
      <Show when={language.locale() !== "en"}>
        <p data-component="legal-notice">{`${i18n.t("legal.englishOnly")} ${i18n.t("legal.englishGoverns")}`}</p>
      </Show>
      <section ref={hero} data-component="hero" data-slot="legal-header" data-view={view()} lang="en" dir="ltr">
        <h1>{props.document.title}</h1>
        <div data-slot="meta">
          <p data-slot="dates">
            {props.document.effective}
            <Show when={changed}>
              {(version) => (
                <>
                  {" · "}
                  <a
                    href="#history"
                    onClick={(event) => {
                      event.preventDefault()
                      openHistory(true)
                    }}
                  >
                    Text last changed {legalDate(version().date)}
                  </a>
                </>
              )}
            </Show>
          </p>
          <Show when={view() === "toggle" && versions.length > 0}>
            <div data-slot="segmented" role="group" aria-label="View">
              <button type="button" aria-pressed={!historyOpen() ? "true" : "false"} onClick={() => openHistory(false)}>
                Document
              </button>
              <button type="button" aria-pressed={historyOpen() ? "true" : "false"} onClick={() => openHistory(true)}>
                History
              </button>
            </div>
          </Show>
        </div>
        <div data-slot="actions">
          <Show when={(view() === "inline" || view() === "drawer") && versions.length > 0}>
            <button
              type="button"
              data-component="site-button"
              data-variant="neutral"
              aria-expanded={historyOpen() ? "true" : "false"}
              aria-haspopup={view() === "drawer" ? "dialog" : undefined}
              aria-controls="history"
              onClick={() => openHistory(!historyOpen())}
            >
              History
              <Show when={view() === "inline"}>
                <Chevron />
              </Show>
              <Show when={view() === "drawer"}>
                <span data-slot="count">{versions.length}</span>
              </Show>
            </button>
          </Show>
          <button
            type="button"
            data-component="site-button"
            data-variant="neutral"
            data-design="legalPrintStyle"
            onClick={() => window.print()}
          >
            <DownloadIcon />
            Save as PDF
          </button>
          <CopyMarkdown path={props.document.path} />
        </div>
      </section>
      <Show when={view() === "tabs" && versions.length > 0}>
        <div ref={tabs} data-slot="view-tabs" role="tablist" aria-label="View" lang="en">
          <For each={["document", "history"] as const}>
            {(tab) => (
              <button
                type="button"
                role="tab"
                id={`tab-${tab}`}
                aria-selected={(tab === "history") === historyOpen() ? "true" : "false"}
                aria-controls={tab === "history" ? "history" : "document"}
                tabIndex={(tab === "history") === historyOpen() ? 0 : -1}
                onClick={(event) => {
                  openHistory(tab === "history")
                  revealTab(event.currentTarget)
                }}
                onKeyDown={(event) => {
                  // Arrows move between the two tabs, Home and End go to the first and last.
                  const next =
                    event.key === "Home"
                      ? false
                      : event.key === "End"
                        ? true
                        : event.key === "ArrowRight" || event.key === "ArrowLeft"
                          ? !historyOpen()
                          : undefined
                  if (next === undefined) return
                  event.preventDefault()
                  openHistory(next)
                  const target = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
                    `#tab-${next ? "history" : "document"}`,
                  )
                  if (!target) return
                  target.focus({ preventScroll: true })
                  revealTab(target)
                }}
              >
                {tab === "history" ? `History (${versions.length})` : "Document"}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={view() === "inline" && versions.length > 0}>
        <div hidden={!historyOpen()} data-slot="history-inline">
          {history()}
        </div>
      </Show>
      <Show when={swaps() && versions.length > 0}>
        <div
          data-slot="history-view"
          hidden={!historyOpen()}
          role={view() === "tabs" ? "tabpanel" : undefined}
          aria-labelledby={view() === "tabs" ? "tab-history" : undefined}
        >
          {history(view() === "contents")}
        </div>
      </Show>
      <div
        data-component="legal-body"
        id="document"
        lang="en"
        dir="ltr"
        hidden={showingHistory()}
        role={view() === "tabs" && versions.length > 0 ? "tabpanel" : undefined}
        aria-labelledby={view() === "tabs" && versions.length > 0 ? "tab-document" : undefined}
      >
        <Show when={summary}>{(points) => <LegalSummary points={points()} />}</Show>
        {/* Phones have no aside, so the sections fold up above the text. */}
        <Show when={sections.length > 1}>
          <ContentsMenu items={sections} />
        </Show>
        <article data-component="legal-document">
          <LegalReferences.Provider value={references}>
            <For each={props.document.body}>{(node) => <LegalBody node={node} anchors />}</For>
          </LegalReferences.Provider>
        </article>
        <LegalPrint
          style={printStyle()}
          part="colophon"
          labelCase={labelCase()}
          document={props.document}
          sections={sections}
          references={references}
        />
      </div>
      <Show when={view() === "drawer" && versions.length > 0}>
        <dialog
          ref={drawer}
          lang="en"
          data-component="legal-drawer"
          aria-labelledby="drawer-title"
          onClose={() => openHistory(false)}
          onClick={(event) => {
            // A click on the backdrop lands on the dialog itself.
            if (event.target === event.currentTarget) openHistory(false)
          }}
        >
          <div data-slot="drawer-head">
            <h2 id="drawer-title">History</h2>
            <button
              type="button"
              data-slot="drawer-close"
              aria-label="Close history"
              onClick={() => openHistory(false)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3.5 3.5L12.5 12.5M12.5 3.5L3.5 12.5" stroke="currentColor" stroke-width="1.25" />
              </svg>
            </button>
          </div>
          <div data-slot="drawer-body">{history()}</div>
        </dialog>
      </Show>
    </Site>
  )
}

/**
 * The document's sections for "Contents": each h2 with an id. The Privacy Policy's own inline
 * table of contents is left out.
 */
function legalSections(body: LegalNode[]) {
  // Review notes (data-review) are hidden from readers, so their headings stay out of Contents.
  return body
    .filter(published)
    .filter((node) => typeof node !== "string" && node[0] === "h2" && node[1].id)
    .map((node) => node as Exclude<LegalNode, string>)
    .filter((node) => !node[1].id.endsWith("table-of-contents"))
    .map((node) => ({ id: node[1].id, title: legalText(node) }))
}

/** Whether an address fragment is History or one of its parts: a version, or what changed. */
const inHistory = (hash: string) => hash === "#history" || hash === "#history-changes" || hash.startsWith("#version-")

/**
 * Where the page scrolls to keep a pinned tab bar pinned with the view under it starting at its top,
 * or undefined when the bar is not pinned. The bar's place in the flow is read from the view after
 * it, since a pinned (sticky) bar reports where it is drawn.
 */
function pinnedScroll(tabs: HTMLElement) {
  const panel = [...(tabs.parentElement?.children ?? [])].find(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && !element.hidden && !!(tabs.compareDocumentPosition(element) & 4),
  )
  if (!panel) return undefined
  const style = getComputedStyle(tabs)
  const top = parseFloat(style.top)
  const flow = panel.getBoundingClientRect().top - parseFloat(style.marginBottom) - tabs.offsetHeight
  return flow < top - 0.5 ? flow + window.scrollY - top : undefined
}

/** Scrolls the tab row sideways, never the page, to show a tab cut off at its edges. */
function revealTab(tab: HTMLElement) {
  const list = tab.parentElement
  if (!list) return
  const item = tab.getBoundingClientRect()
  const box = list.getBoundingClientRect()
  if (item.left < box.left) list.scrollLeft -= box.left - item.left
  if (item.right > box.right) list.scrollLeft += item.right - box.right
}

function legalText(node: LegalNode): string {
  if (typeof node === "string") return node
  const [, , ...children] = node
  return children.map(legalText).join("")
}

/**
 * Copies the page's Markdown version (its `.md` URL) to the clipboard. The text is fetched on hover
 * or focus, so a click can copy at once; the Clipboard API is tried first, then a hidden text field
 * for embedded browsers that block it. The label says "Copied" for 1.5s; on failure it says "Copy
 * failed" and opens the Markdown in a new tab. Every label is laid out at once, so the width holds.
 */
function CopyMarkdown(props: { path: string }) {
  const url = `${props.path}.md`
  const [state, setState] = createSignal<"idle" | "copied" | "failed">("idle")
  const cache: { text?: Promise<string> } = {}
  const load = () =>
    (cache.text ??= fetch(url).then((response) => {
      if (!response.ok) throw new Error(`${response.status}`)
      return response.text()
    }))
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const show = (next: "copied" | "failed") => {
    setState(next)
    clearTimeout(timer)
    timer = setTimeout(() => setState("idle"), 1500)
  }
  const copy = async () => {
    const copied = await load()
      .then((text) =>
        navigator.clipboard
          ? navigator.clipboard.writeText(text).then(
              () => true,
              () => copySelection(text),
            )
          : copySelection(text),
      )
      .catch(() => false)
    show(copied ? "copied" : "failed")
    if (!copied) window.open(url, "_blank", "noopener")
  }
  const labels = { idle: "Copy as Markdown", copied: "Copied", failed: "Copy failed" } as const
  return (
    <>
      <button
        type="button"
        data-component="site-button"
        data-variant="neutral"
        data-slot="copy-markdown"
        data-state={state()}
        onPointerEnter={() => void load().catch(() => undefined)}
        onFocus={() => void load().catch(() => undefined)}
        onClick={() => void copy()}
      >
        <Show when={state() === "copied"} fallback={<CopyIcon />}>
          <CheckIcon />
        </Show>
        <span data-slot="labels">
          <For each={Object.entries(labels)}>
            {([key, label]) => (
              <span data-label={key} aria-hidden={key === state() ? undefined : "true"}>
                {label}
              </span>
            )}
          </For>
        </span>
      </button>
      {/* Outside the button, so its name stays the label; screen readers hear "Copied" here. */}
      <span data-slot="sr-only" role="status" aria-live="polite">
        {state() === "idle" ? "" : labels[state()]}
      </span>
    </>
  )
}

/**
 * The plain-language summary above the text, in the style Settings › Legal summary picks. The
 * accordion starts open, and closed on phones.
 */
function LegalSummary(props: { points: LegalNode[][] }) {
  let details: HTMLDetailsElement | undefined
  onMount(() => {
    if (details && window.matchMedia("(max-width: 60rem)").matches) details.open = false
  })
  const list = (
    <ul>
      <For each={props.points}>
        {(point) => (
          <li>
            <For each={point}>{(node) => <LegalBody node={node} />}</For>
          </li>
        )}
      </For>
    </ul>
  )
  return (
    <Show
      when={siteSettings.legalSummaryStyle === "accordion"}
      fallback={
        <aside
          data-component="legal-summary"
          data-style={siteSettings.legalSummaryStyle}
          data-design="legalSummaryStyle"
          aria-labelledby="summary"
        >
          <h2 id="summary">Summary</h2>
          {list}
        </aside>
      }
    >
      <details ref={details} data-component="legal-summary" data-style="accordion" data-design="legalSummaryStyle" open>
        <summary>
          <span id="summary">Summary</span>
          <Chevron />
        </summary>
        {list}
      </details>
    </Show>
  )
}

/**
 * The text versions from git, newest first, and what the latest one changed. `onBack` adds a link
 * back to the text, for views where History replaces it.
 */
function LegalHistory(props: { document: LegalDocumentContent; onBack?: () => void }) {
  const versions = legalVersions(props.document.path)
  const latest = versions[0]
  const more = (shown: number, total: number) => total - shown
  return (
    <section data-component="legal-history" id="history" lang="en" dir="ltr" aria-label="History">
      <Show when={props.onBack}>
        {(back) => (
          <a
            data-slot="back"
            href="#document"
            onClick={(event) => {
              event.preventDefault()
              back()()
            }}
          >
            ← Back to document
          </a>
        )}
      </Show>
      <Show when={!latest.first}>
        <div data-slot="changes">
          <h2 id="history-changes">What changed</h2>
          <p>
            <time datetime={latest.date}>{legalDate(latest.date)}</time>. The sentences this version added and removed,
            word for word.{" "}
            <a href={latest.diff} target="_blank" rel="noopener">
              Full diff on GitHub
              <ExternalArrow />
              <NewTab />
            </a>
          </p>
          <Show when={latest.removed.length > 0}>
            <h3>Removed</h3>
            <ul>
              <For each={latest.removed}>
                {(sentence) => (
                  <li>
                    <del>{sentence}</del>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show when={latest.added.length > 0}>
            <h3>Added</h3>
            <ul>
              <For each={latest.added}>
                {(sentence) => (
                  <li>
                    <ins>{sentence}</ins>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show
            when={more(latest.added.length, latest.addedCount) + more(latest.removed.length, latest.removedCount) > 0}
          >
            <p>
              And {more(latest.added.length, latest.addedCount) + more(latest.removed.length, latest.removedCount)} more
              in the diff.
            </p>
          </Show>
        </div>
      </Show>
      <h2>All versions</h2>
      <p>
        Each version changed the text. The documents live in OpenCode's public repository, so every change has a diff.
      </p>
      <ol data-slot="versions">
        <For each={versions}>
          {(version, index) => (
            <li id={`version-${version.sha.slice(0, 7)}`}>
              <time datetime={version.date}>{legalDate(version.date)}</time>
              <span data-slot="detail">
                <span>
                  {version.first ? "First published" : `${version.addedCount} added, ${version.removedCount} removed`}
                  <Show when={index() === 0}> · this version</Show>
                  <Show when={version.effective}>{(effective) => <> · states effective {effective()}</>}</Show>
                </span>
                <span data-slot="subject">{version.subject}</span>
              </span>
              <span data-slot="links">
                <Show when={!version.first}>
                  <a href={version.diff} target="_blank" rel="noopener">
                    Diff
                    <span data-slot="sr-only"> of {legalDate(version.date)}</span>
                    <ExternalArrow />
                    <NewTab />
                  </a>
                </Show>
                <a href={version.source} target="_blank" rel="noopener">
                  Source
                  <span data-slot="sr-only"> of {legalDate(version.date)}</span>
                  <ExternalArrow />
                  <NewTab />
                </a>
              </span>
            </li>
          )}
        </For>
      </ol>
      <p>
        Follow changes to every legal document in a feed reader: <a href={feed}>RSS feed</a>.
      </p>
    </section>
  )
}

/** A run of document nodes as on the page, without heading links (the print layout editor's preview). */
export function LegalText(props: { nodes: LegalNode[] }) {
  return <For each={props.nodes}>{(node) => <LegalBody node={node} />}</For>
}

// The documents never change while a page is open, so each node renders once.
function LegalBody(props: {
  node: LegalNode
  /** Makes section headings copy their address when clicked (the shared HeadingLink). */
  anchors?: boolean
}) {
  if (typeof props.node === "string") return props.node
  const node = props.node
  if (published(node)) return <LegalElement node={node} anchors={props.anchors} />
  // A note to the legal reviewers in a draft: shown only with Settings › Legal review notes.
  return (
    <Show when={siteSettings.legalReviewNotes === "on"}>
      <LegalElement node={node} anchors={props.anchors} />
    </Show>
  )
}

function LegalElement(props: { node: Exclude<LegalNode, string>; anchors?: boolean }) {
  const language = useLanguage()
  const [tag, attributes, ...children] = props.node
  const href = attributes.href?.startsWith("/") ? language.route(attributes.href) : attributes.href
  const reference = useLegalReference(tag === "a" ? href : undefined)
  return (
    <Dynamic
      component={tag}
      {...attributes}
      href={href}
      data-print-href={tag === "a" ? printHref(href, children) : undefined}
      data-ref={tag === "a" ? reference : undefined}
    >
      <Show
        when={props.anchors && attributes.id && (tag === "h2" || tag === "h3") ? attributes.id : undefined}
        fallback={<For each={children}>{(child) => <LegalBody node={child} anchors={props.anchors} />}</For>}
      >
        {(id) => (
          <HeadingLink id={id()} title={legalText(props.node)}>
            <For each={children}>{(child) => <LegalBody node={child} anchors={props.anchors} />}</For>
          </HeadingLink>
        )}
      </Show>
    </Dynamic>
  )
}

/** The address a printed link shows after its text, unless the text already is the address. */
function printHref(href: string | undefined, children: LegalNode[]) {
  if (!href || href.startsWith("#") || href.startsWith("mailto:")) return
  const url = href.startsWith("/") ? `${config.baseUrl}${href}` : href
  const text = children.map(legalText).join("").trim()
  if (
    url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") ===
    text.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")
  )
    return
  return url
}

/** The groups of the "grouped" legal list, by document path. */
const legalGroups = [
  { title: "Policies", paths: ["/legal/privacy-policy"] },
  { title: "Agreements", paths: ["/legal/terms-of-service"] },
]

/**
 * The legal index: every document with its description and date, a feed of changes, and related
 * pages, in the Press column (the space of its Contents rail is left empty). Settings › Legal list
 * picks how the documents are listed and Settings › Legal row hover how a row answers the pointer;
 * each document is a single link.
 */
export function LegalHub() {
  const i18n = useI18n()
  const language = useLanguage()
  const markdown = useMarkdown("/legal", legalHubMarkdown)
  const title = "OpenCode | Privacy policy, terms and legal updates"
  const description =
    "Every OpenCode legal document in one place, including the Privacy Policy and the Terms of Use, with their dates, version history and a feed of changes."
  const style = () => siteSettings.legalHubStyle
  // Group headings only help a longer list: they show once more than one group has documents and
  // there are more than three, so two documents read as one plain list.
  const groups = legalGroups
    .map((group) => ({
      title: group.title,
      documents: legalPages.filter((document) => group.paths.includes(document.path)),
    }))
    .filter((group) => group.documents.length > 0)
  const grouped = () => style() === "grouped" && groups.length > 1 && legalPages.length > 3
  const Item = (props: { document: LegalDocumentContent }) => {
    const changed = legalTextChanged(props.document)
    return (
      <li>
        <a href={language.route(props.document.path)}>
          <Show when={style() === "tiles"}>
            <DocumentGlyph />
          </Show>
          <span data-slot="title">{props.document.title}</span>
          <span data-slot="description">{props.document.description}</span>
          <span data-slot="dates">
            <span>{props.document.effective}</span>
            <Show when={changed}>
              {(version) => (
                <>
                  <span data-slot="separator"> · </span>
                  <span>Text last changed {legalDate(version().date)}</span>
                </>
              )}
            </Show>
          </span>
          <Show when={style() === "rows" || style() === "grouped"}>
            <span data-slot="arrow" aria-hidden="true">
              →
            </span>
          </Show>
        </a>
      </li>
    )
  }

  const List = (props: { documents: LegalDocumentContent[] }) => (
    <ul
      data-component="legal-list"
      data-style={style()}
      data-hover={siteSettings.legalRowHover}
      data-design="legalHubStyle legalRowHover"
    >
      <For each={props.documents}>{(document) => <Item document={document} />}</For>
    </ul>
  )

  return (
    <Site page="legal-hub" markdown={markdown}>
      <Title>{title}</Title>
      <ShareMeta title={title} description={description} image={ogImage("/legal")} englishOnly />
      <LocaleLinks path="/legal" englishOnly />
      <Meta name="description" content={description} />
      <Link rel="alternate" type="application/rss+xml" title={feedTitle} href={feed} />
      <JsonLd
        data={breadcrumbData([
          { name: "Home", path: "/" },
          { name: "Legal", path: "/legal" },
        ])}
      />
      <section data-component="hero" lang="en" dir="ltr">
        <PageTitle title="Legal" />
        <p>The legal documents for the OpenCode website and hosted services.</p>
      </section>
      <Show when={language.locale() !== "en"}>
        <p data-component="legal-notice">{`${i18n.t("legal.englishOnly")} ${i18n.t("legal.englishGoverns")}`}</p>
      </Show>
      {/* The list is the page: no section titles. In "grouped" the group names are its only headings. */}
      <div data-component="legal-hub" lang="en" dir="ltr">
        <Show when={grouped()} fallback={<List documents={legalPages} />}>
          <For each={groups}>
            {(group) => (
              <section data-slot="group" aria-labelledby={slug(group.title)}>
                <SectionHeading id={slug(group.title)} title={group.title} />
                <List documents={group.documents} />
              </section>
            )}
          </For>
        </Show>
        <ul data-slot="related" aria-label="Related">
          <li>
            <a href={feed}>
              <FeedIcon />
              Follow changes by RSS
            </a>
          </li>
          <li>
            <a href={language.route("/brand")}>Brand and trademark guidelines</a>
          </li>
          <li>
            <a href="https://github.com/anomalyco/opencode/blob/dev/LICENSE" target="_blank" rel="noopener">
              Open source license (MIT)
              <ExternalArrow />
              <NewTab />
            </a>
          </li>
        </ul>
      </div>
    </Site>
  )
}

/** The feed symbol: a dot and two quarter rings. */
function FeedIcon() {
  return (
    <svg data-slot="feed-icon" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="1" y="9" width="2" height="2" fill="currentColor" />
      <path d="M1.5 5.5A5 5 0 0 1 6.5 10.5M1.5 1.5A9 9 0 0 1 10.5 10.5" stroke="currentColor" stroke-width="1.25" />
    </svg>
  )
}

/** A page with a folded corner, for the "tiles" legal list. */
function DocumentGlyph() {
  return (
    <svg data-slot="glyph" width="20" height="24" viewBox="0 0 20 24" fill="none" aria-hidden="true">
      <path d="M1.5 0.5H13L18.5 6V23.5H1.5V0.5Z" stroke="currentColor" />
      <path d="M13 0.5V6H18.5M5 11H15M5 15H15M5 19H11" stroke="currentColor" />
    </svg>
  )
}
