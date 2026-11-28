import { For, Show, type JSX } from "solid-js"
import { DocsLockup, DocsSectionLinks, docsSectionName, type DocsVersion } from "~/component/site/docs-lockup"
import { DocsVersionNotice } from "~/component/site/docs-version-notice"
import { GitHubLink } from "~/component/site/github-link"
import { Chevron, NewTab, SearchIcon } from "~/component/site/icons"
import { interLatin } from "~/component/site/inter-fonts"
import { LogoIcon } from "~/component/site/marks"
import { Bracket } from "~/component/site/site-controls"
import { monoFontLatin } from "~/component/site/mono-fonts"
import { OnThisPage } from "~/component/site/on-this-page"
import { defaultRootAttributes, themeScript } from "~/component/site/preload-settings"
import { shareTags } from "~/component/share-meta"
import { config } from "~/config"
import { useI18n } from "~/context/i18n"
import type { I18n } from "~/context/i18n-context"
import { dir, parseLocale, route, tag, type Locale } from "~/lib/language"
import { ogImage } from "~/lib/og"
import { latestDocs, type DocsSet } from "../config"
import { DocsFooter } from "../components/DocsFooter"
import { DocsSearchDialog } from "../components/DocsSearchDialog"
import { DocsNav } from "../components/DocsSidebar"
import { docsCanonicalHref, docsHref, docsLocaleBase, docsLocaleHref, type DocsSection } from "../lib/navigation"
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

// Pages load as plain documents (no client router). The browser prerenders a docs link in the
// page's language once the pointer rests on it, and docs.css turns on cross-document view
// transitions, so a click shows the next page at once, without a blank frame.
const speculationRules = (base: string) =>
  JSON.stringify({ prerender: [{ where: { href_matches: `${base}*` }, eagerness: "moderate" }] })

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
  /** The latest docs' page language, and whether its content is translated here (else English with a notice). */
  locale: Locale
  translated: boolean
  /** The page's head languages, English and each current translation, itself included (render.tsx). */
  alternates: readonly Locale[]
  /** The current section in the page's language (render.tsx). */
  section: DocsSection
  /** The page's source file from the repository root, for "Edit this page"; generated pages have none. */
  source?: string
  /** The page's Markdown twin; generated pages have none. */
  markdown?: string
  versions?: DocsVersions
  v1?: DocsV1
  children: JSX.Element
}) {
  const i18n = useI18n()
  const section = props.section
  // Pagination stays in the set.
  const pages = section.groups.flatMap((group) => group.items.filter((item) => !item.href))
  const at = pages.findIndex((item) => item.slug === props.currentSlug)
  const previous = at > 0 ? pages[at - 1] : undefined
  const next = at >= 0 ? pages[at + 1] : undefined
  const current = pages[at]
  const description = props.description ?? `${props.title} documentation for OpenCode.`
  const title = `${props.title} | OpenCode${props.set.id === "v1" ? " V1" : ""}`
  const locale = props.locale
  const docsBase = docsLocaleBase(locale, props.set)
  const canonical = new URL(docsCanonicalHref(props.currentSlug, props.set, locale, props.translated), config.baseUrl)
    .href
  // render.tsx passes the sitemap's set: English and every current translation, itself included.
  // A fallback page lists only English, as it canonicalises there (sitemap.ts).
  const alternates = props.set.id === "latest" ? props.alternates : []
  const sectionHrefs = {
    Docs: docsLocaleHref("index", latestDocs, locale),
    CLI: docsLocaleHref("cli", latestDocs, locale),
    Build: docsLocaleHref("build", latestDocs, locale),
    API: docsLocaleHref("api", latestDocs, locale),
    Console: docsLocaleHref("console", latestDocs, locale),
  }
  const contents = props.headings
    .filter((heading) => heading.depth === 2 || heading.depth === 3)
    .map((heading) => ({ id: heading.slug, title: heading.text, level: heading.depth as 2 | 3 }))
  const logo = () => (
    <a
      href={locale === "en" ? "/" : `/${locale}`}
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
      lang={props.v1 ? (props.v1.locale.lang ?? (props.v1.locale.path || "en")) : tag(locale)}
      dir={props.v1 ? (props.v1.locale.path === "ar" ? "rtl" : "ltr") : dir(locale)}
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
        <script type="speculationrules" innerHTML={speculationRules(docsBase)} />
        <link rel="canonical" href={canonical} />
        <link rel="icon" type="image/svg+xml" href={`${latestDocs.base}favicon.svg`} />
        <For each={alternates}>
          {(alternate) => (
            <link
              rel="alternate"
              hreflang={tag(alternate)}
              href={new URL(docsLocaleHref(props.currentSlug, props.set, alternate), config.baseUrl).href}
            />
          )}
        </For>
        <Show when={props.set.id === "latest" && !props.noindex}>
          <link
            rel="alternate"
            hreflang="x-default"
            href={new URL(docsHref(props.currentSlug, props.set), config.baseUrl).href}
          />
        </Show>
        <Show when={props.markdown}>{(href) => <link rel="alternate" type="text/markdown" href={href()} />}</Show>
        <title>{title}</title>
        {/* The link preview: OG Studio's /docs card (image and video) in English, with the page's title and description. */}
        <For
          each={shareTags({
            title,
            description,
            image: ogImage("/docs"),
            locale,
            englishOnly: props.set.id === "v1",
          })}
        >
          {(meta) => <meta {...meta} />}
        </For>
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
          data-docs-base={docsBase}
          data-locale={
            props.set.id === "v1" ? (parseLocale(props.v1?.locale.site ?? props.v1?.locale.path) ?? undefined) : locale
          }
          data-strings={JSON.stringify(clientStrings(i18n))}
          {...rootAttributes()}
        >
          <script innerHTML={themeMigration + themeScript(false)} />
          <a href="#content" data-component="skip-link">
            {i18n.t("site.skipToContent")}
          </a>
          <header data-component="topbar">
            {logo()}
            <DocsLockup inline="topbar" home={sectionHrefs.Docs} />
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
          <DocsSectionLinks
            current={section.key}
            v1={props.set.id === "v1"}
            v1Href={props.versions?.v1}
            hrefs={sectionHrefs}
          />

          <div data-slot="frame">
            <aside
              data-component="sidebar"
              data-section-nav
              data-section="nav"
              aria-label={i18n.t("site.landmark.navigation")}
            >
              <DocsLockup inline="sidebar" home={sectionHrefs.Docs} />
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
                    locale={locale}
                  />
                </div>
              </div>
            </aside>
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
                  <Show when={props.set.id === "v1" && props.versions}>
                    {(versions) => <DocsVersionNotice latest={versions().latest} />}
                  </Show>
                  <Show when={props.set.id === "latest" && !props.translated}>
                    <p data-component="docs-translation-notice" data-pagefind-ignore>
                      {i18n.t("docs.translation.missing")}
                    </p>
                  </Show>
                  {/* A fallback page's article is the English one, so tell readers and search
                      engines it is English, inside the page's own language. */}
                  <div data-slot="docs-content" lang={props.translated ? undefined : "en"}>
                    <h1 data-pagefind-meta={`section:${docsSectionName(i18n, section.title)}`}>{props.title}</h1>
                    {props.children}
                  </div>
                  <footer data-slot="article-footer" data-pagefind-ignore>
                    <Show when={previous || next}>
                      <nav aria-label={i18n.t("docs.pages")} data-component="pagination">
                        <Show when={previous}>
                          {(page) => (
                            <a href={docsLocaleHref(page().slug, props.set, locale)} rel="prev">
                              <small>{i18n.t("docs.previous")}</small> {page().title}
                            </a>
                          )}
                        </Show>
                        <Show when={next}>
                          {(page) => (
                            <a href={docsLocaleHref(page().slug, props.set, locale)} rel="next">
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

          <DocsFooter
            set={props.set}
            slug={props.currentSlug}
            locale={locale}
            markdown={props.markdown}
            languages={props.v1?.languages}
            current={props.v1?.locale}
          />
          <DocsSearchDialog set={props.set} locale={locale} />
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
