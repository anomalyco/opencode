import { For, Show, type JSX } from "solid-js"
import { DocsLockup, docsSectionName, type DocsVersion } from "~/component/site/docs-lockup"
import { DocsVersionNotice } from "~/component/site/docs-version-notice"
import { GitHubLink } from "~/component/site/github-link"
import { Chevron, NewTab, SearchIcon } from "~/component/site/icons"
import { interLatin } from "~/component/site/inter-fonts"
import { LogoIcon } from "~/component/site/marks"
import { Bracket } from "~/component/site/site-controls"
import { monoFontLatin } from "~/component/site/mono-fonts"
import { OnThisPage } from "~/component/site/on-this-page"
import { defaultRootAttributes, themeScript } from "~/component/site/preload-settings"
import { config } from "~/config"
import { useI18n } from "~/context/i18n"
import type { I18n } from "~/context/i18n-context"
import { parseLocale } from "~/lib/language"
import { latestDocs, type DocsSet } from "../config"
import { DocsFooter } from "../components/DocsFooter"
import { DocsSearchDialog } from "../components/DocsSearchDialog"
import { DocsNav } from "../components/DocsSidebar"
import { docsHref, getDocsSection, type DocsSection } from "../lib/navigation"
import type { V1Locale } from "../lib/v1-navigation"
import type { DocsHeading } from "../rehype-headings"

/** The URLs of the docs' stylesheet (styles/docs.css) and browser script (client.ts). */
export type DocsAssets = { stylesheet: string; script: string }

/** The page in each docs version, for the lockup's versions and the V1 notice (render.tsx). */
export type DocsVersions = Record<DocsVersion, string>

/**
 * A V1 page's language, its section in that language, the page in every language, and where its
 * links' anchors are on the pages they go to (render.tsx).
 */
export type DocsV1 = {
  locale: V1Locale
  section: DocsSection
  languages: (V1Locale & { href: string })[]
  anchor: (href: string) => string
}

// Before first paint, inside the site root: the saved theme, as on the site (preload-settings.ts),
// after taking over a choice saved by the docs before they shared the site's theme ("docs-theme").
const themeMigration = `try{const o=localStorage.getItem("docs-theme");if(o){if(!localStorage.getItem("opencode-theme")&&(o==="light"||o==="dark"))localStorage.setItem("opencode-theme",o);localStorage.removeItem("docs-theme")}}catch{}`

// Pages load as plain documents (no client router). The browser prerenders a docs link once the
// pointer rests on it, and docs.css turns on cross-document view transitions, so a click shows the
// next page at once, without a blank frame.
const speculationRules = (set: DocsSet) =>
  JSON.stringify({ prerender: [{ where: { href_matches: `${set.base}*` }, eagerness: "moderate" }] })

/**
 * A docs page in the site's docs layout (site.css `[data-layout="docs"]`): the logo and the section
 * lockup over the section's nav on the left, the article, and search over the Contents rail on the
 * right, all on the site's root attributes as production renders them. Below 960px the top bar, the
 * section menu and the Contents bar take over. Everything interactive works through client.ts.
 */
export function DocsLayout(props: {
  set: DocsSet
  title: string
  description?: string
  currentSlug: string
  headings: DocsHeading[]
  noindex?: boolean
  assets: DocsAssets
  /** The page's source file from the repository root, for "Edit this page"; generated pages have none. */
  source?: string
  /** The page's Markdown twin; generated pages have none. */
  markdown?: string
  versions?: DocsVersions
  v1?: DocsV1
  children: JSX.Element
}) {
  const i18n = useI18n()
  const section = props.v1?.section ?? getDocsSection(props.currentSlug)
  // Pagination stays in the set.
  const pages = section.groups.flatMap((group) => group.items.filter((item) => !item.href))
  const at = pages.findIndex((item) => item.slug === props.currentSlug)
  const previous = at > 0 ? pages[at - 1] : undefined
  const next = at >= 0 ? pages[at + 1] : undefined
  const current = pages[at]
  const description = props.description ?? `${props.title} documentation for OpenCode.`
  const canonical = new URL(docsHref(props.currentSlug, props.set), "https://opencode.ai").href
  const contents = props.headings
    .filter((heading) => heading.depth === 2 || heading.depth === 3)
    .map((heading) => ({ id: heading.slug, title: heading.text, level: heading.depth as 2 | 3 }))
  // The lockup's versions: this page in each (the versions menu under "Docs"; V1 pages read "V1 docs").
  const version = () =>
    props.versions && {
      current: props.set.id,
      href: (id: DocsVersion) => props.versions![id],
      onSelect: () => undefined,
    }
  const logo = () => (
    <a
      href="/"
      data-slot="logo"
      data-variant="icon"
      data-nav-logo
      aria-haspopup="menu"
      aria-expanded="false"
      aria-label={i18n.t("nav.logoHome")}
      title={i18n.t("nav.logoHome")}
    >
      <LogoIcon />
    </a>
  )

  return (
    <html
      lang={props.v1 ? (props.v1.locale.lang ?? (props.v1.locale.path || "en")) : "en"}
      dir={props.v1?.locale.path === "ar" ? "rtl" : "ltr"}
    >
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="description" content={description} />
        <Show when={props.noindex || props.set.noindex}>
          <meta name="robots" content="noindex" />
        </Show>
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#fbfbfb" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0c0c0c" />
        <meta name="color-scheme" content="light dark" />
        <script type="speculationrules" innerHTML={speculationRules(props.set)} />
        <link rel="canonical" href={canonical} />
        <link rel="icon" type="image/svg+xml" href={`${latestDocs.base}favicon.svg`} />
        <Show when={props.markdown}>{(href) => <link rel="alternate" type="text/markdown" href={href()} />}</Show>
        <title>{`${props.title} | OpenCode${props.set.id === "v1" ? " V1" : ""}`}</title>
        <link rel="preload" href={interLatin} as="font" type="font/woff2" crossorigin="anonymous" />
        <link rel="preload" href={monoFontLatin} as="font" type="font/woff2" crossorigin="anonymous" />
        <link rel="stylesheet" href={props.assets.stylesheet} />
      </head>
      <body>
        <div
          data-site
          data-page="docs"
          data-layout="docs"
          data-theme="system"
          data-docs-base={props.set.base}
          data-locale={parseLocale(props.v1?.locale.site ?? props.v1?.locale.path) ?? undefined}
          data-strings={JSON.stringify(clientStrings(i18n))}
          {...rootAttributes()}
        >
          <script innerHTML={themeMigration + themeScript(false)} />
          <a href="#content" data-component="skip-link">
            {i18n.t("site.skipToContent")}
          </a>
          <header data-component="topbar">
            {logo()}
            <DocsLockup current={section.title} inline="topbar" version={version()} />
            <button
              type="button"
              data-slot="search-button"
              data-search-open
              aria-label={i18n.t("docs.search.open")}
              aria-haspopup="dialog"
            >
              <SearchIcon />
            </button>
            <GitHubLink owner="topbar" />
          </header>

          <div data-slot="frame">
            <aside
              data-component="sidebar"
              data-section-nav
              data-section="nav"
              aria-label={i18n.t("site.landmark.navigation")}
            >
              <DocsLockup current={section.title} inline="sidebar" version={version()} />
              {logo()}
              <div data-component="section-nav">
                <button type="button" data-slot="section-toggle" aria-expanded="false" aria-controls="section-nav">
                  {/* The current page as the nav marks it ("[-] Intro" on /docs). */}
                  <span data-slot="current">
                    <Bracket />
                    <span data-slot="label">{current?.title ?? props.title}</span>
                  </span>
                  <Chevron />
                </button>
                <div data-slot="section-body" id="section-nav">
                  <DocsNav
                    set={props.set}
                    section={section.title}
                    groups={section.groups}
                    currentSlug={props.currentSlug}
                  />
                </div>
              </div>
            </aside>
            {/* V1: the notice sits in the logo row, after the sidebar's label so it can start past a long one
                (docs.css); phones show it as a bar on the screen's bottom edge. */}
            <Show when={props.set.id === "v1" && props.versions}>
              {(versions) => <DocsVersionNotice latest={versions().latest} placement="header" />}
            </Show>
            {/* Mobile layout: the Contents rail folded into a bar stuck under the
                section row from load. It names the section being read (client.ts swaps the label as you scroll)
                and keeps "Contents" in its accessible name. Hidden beside the rail on wide screens. */}
            <Show when={contents.length > 0}>
              <details data-component="contents-menu" data-docs-contents>
                <summary aria-label={i18n.t("docs.contentsOf", { section: contents[0].title })}>
                  <span data-slot="label">
                    <span data-slot="word">{contents[0].title}</span>
                  </span>
                  <Chevron />
                </summary>
                <ul>
                  <For each={contents}>
                    {(item) => (
                      <li data-level={item.level === 3 ? "3" : undefined}>
                        <a href={`#${item.id}`}>{item.title}</a>
                      </li>
                    )}
                  </For>
                </ul>
              </details>
            </Show>
            <GitHubLink owner="corner" />

            <main data-component="content" id="content" tabindex={-1}>
              <div data-slot="page">
                <article
                  data-component="docs-article"
                  data-section="article"
                  data-pagefind-body={props.noindex ? undefined : ""}
                  data-pagefind-meta={`title:${props.title}`}
                >
                  <h1 data-pagefind-meta={`section:${docsSectionName(i18n, section.title)}`}>{props.title}</h1>
                  {props.children}
                  <footer data-slot="article-footer" data-pagefind-ignore>
                    <Show when={previous || next}>
                      <nav aria-label={i18n.t("docs.pages")} data-component="pagination">
                        <Show when={previous}>
                          {(page) => (
                            <a href={docsHref(page().slug, props.set)} rel="prev">
                              <small>{i18n.t("docs.previous")}</small> {page().title}
                            </a>
                          )}
                        </Show>
                        <Show when={next}>
                          {(page) => (
                            <a href={docsHref(page().slug, props.set)} rel="next">
                              <small>{i18n.t("docs.next")}</small> {page().title}
                            </a>
                          )}
                        </Show>
                      </nav>
                    </Show>
                    <Show when={props.source}>
                      {(source) => (
                        <p data-component="edit-link">
                          <a href={`${config.github.repoUrl}/blob/dev/${source()}`} target="_blank" rel="noopener">
                            {i18n.t("docs.editPage")}
                            <NewTab />
                          </a>
                          <button type="button" data-copy-markdown data-funnel-copy="page-markdown" data-state="idle">
                            <span data-slot="copy-labels" aria-hidden="true">
                              <span data-label="idle">{i18n.t("docs.copyMarkdown")}</span>
                              <span data-label="copied">{i18n.t("site.action.copied")}</span>
                              <span data-label="failed">{i18n.t("site.code.failed")}</span>
                            </span>
                            <span data-slot="sr-only">{i18n.t("docs.copyMarkdownLabel")}</span>
                          </button>
                          <span data-slot="sr-only" aria-live="polite" />
                        </p>
                      )}
                    </Show>
                  </footer>
                </article>
              </div>
            </main>

            <aside data-component="aside" data-section="aside" aria-label={i18n.t("site.landmark.page")}>
              <div data-component="docs-aside">
                <button
                  type="button"
                  data-slot="search"
                  data-search-open
                  aria-label={i18n.t("docs.search.open")}
                  aria-haspopup="dialog"
                  aria-keyshortcuts="Meta+K Control+K /"
                >
                  <span>{i18n.t("site.search.label")}</span>
                  <kbd dir="ltr">⌘K</kbd>
                </button>
                <Show when={contents.length > 0}>
                  <OnThisPage items={contents} />
                </Show>
              </div>
            </aside>
          </div>

          <DocsFooter markdown={props.markdown} languages={props.v1?.languages} current={props.v1?.locale} />
          <DocsSearchDialog set={props.set} />
        </div>
        <script type="module" src={props.assets.script} />
      </body>
    </html>
  )
}

// What client.ts says in the page's language: the theme switch, copy and search feedback, the status
// and the Contents bar. {{params}} stay for it to fill in.
function clientStrings(i18n: I18n) {
  return {
    system: i18n.t("site.theme.system"),
    light: i18n.t("site.theme.light"),
    dark: i18n.t("site.theme.dark"),
    cycle: i18n.t("site.theme.cycle"),
    copied: i18n.t("site.code.copied"),
    copyFailed: i18n.t("docs.copyFailed"),
    codeFailed: i18n.t("site.code.failedHint"),
    linkCopied: i18n.t("changelog.share.copied"),
    markdownCopied: i18n.t("docs.markdownCopied"),
    noResults: i18n.t("site.search.noResultsFor"),
    empty: i18n.t("docs.search.empty"),
    browse: i18n.t("docs.search.browse"),
    operational: i18n.t("site.status.operationalHeadline"),
    degraded: i18n.t("site.status.degradedHeadline"),
    outage: i18n.t("site.status.outageHeadline"),
    unknown: i18n.t("site.status.unknownHeadline"),
    normal: i18n.t("site.status.operational"),
    status: i18n.t("site.footer.status"),
    statusPrefix: i18n.t("site.status.prefix"),
    contents: i18n.t("docs.contentsOf"),
  }
}

// The site root's settings attributes, with the values production renders (settings-defaults.json),
// so site.css and docs-variants.css apply as they do on the site.
function rootAttributes() {
  return Object.fromEntries(
    Object.entries(defaultRootAttributes()).flatMap(([name, value]) =>
      value === null || name === "data-theme" ? [] : [[name, value]],
    ),
  )
}
