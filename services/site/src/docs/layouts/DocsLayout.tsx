import { For, Show, type JSX } from "solid-js"
import { DocsLockup } from "~/component/site/docs-lockup"
import { GitHubLink } from "~/component/site/github-link"
import { Chevron, SearchIcon } from "~/component/site/icons"
import { interFaces, interLatin } from "~/component/site/inter-fonts"
import { siteLinks } from "~/component/site/links"
import { LogoIcon } from "~/component/site/marks"
import { monoFontFaces, monoFontLatin } from "~/component/site/mono-fonts"
import { ContentsMenu, OnThisPage } from "~/component/site/on-this-page"
import { MenuSheet, MenuToggle } from "~/component/site/phone-menu"
import { defaultRootAttributes, themeScript } from "~/component/site/preload-settings"
import { navDefaults } from "~/component/site/settings"
import { ExternalArrow, NewTab } from "~/component/site/icons"
import { config } from "~/config"
import { useI18n } from "~/context/i18n"
import { base } from "../config"
import { DocsFooter } from "../components/DocsFooter"
import { DocsSearchDialog } from "../components/DocsSearchDialog"
import { DocsNav } from "../components/DocsSidebar"
import { docsHref, getDocsSection } from "../lib/navigation"
import type { DocsHeading } from "../rehype-headings"

/** The URLs of the docs' stylesheet (styles/docs.css) and browser script (client.ts). */
export type DocsAssets = { stylesheet: string; script: string }

// Before first paint, inside the site root: the saved theme, as on the site (preload-settings.ts),
// after taking over a choice saved by the docs before they shared the site's theme ("docs-theme").
const themeMigration = `try{const o=localStorage.getItem("docs-theme");if(o){if(!localStorage.getItem("opencode-theme")&&(o==="light"||o==="dark"))localStorage.setItem("opencode-theme",o);localStorage.removeItem("docs-theme")}}catch{}`

// Pages load as plain documents (no client router). The browser prerenders a docs link once the
// pointer rests on it, and docs.css turns on cross-document view transitions, so a click shows the
// next page at once, without a blank frame.
const speculationRules = JSON.stringify({
  prerender: [{ where: { href_matches: `${base}*` }, eagerness: "moderate" }],
})

/**
 * A docs page in the site's docs layout (site.css `[data-layout="docs"]`): the logo and the section
 * lockup over the section's nav on the left, the article, and search over the Contents rail on the
 * right, all on the site's root attributes as production renders them. Below 960px the top bar, the
 * section menu and the Contents bar take over. Everything interactive works through client.ts.
 */
export function DocsLayout(props: {
  title: string
  description?: string
  currentSlug: string
  headings: DocsHeading[]
  noindex?: boolean
  assets: DocsAssets
  /** The page's source file under src/docs, for "Edit this page"; generated pages have none. */
  source?: string
  /** The page's Markdown twin; generated pages have none. */
  markdown?: string
  children: JSX.Element
}) {
  const i18n = useI18n()
  const section = getDocsSection(props.currentSlug)
  const pages = section.groups.flatMap((group) => group.items)
  const at = pages.findIndex((item) => item.slug === props.currentSlug)
  const previous = at > 0 ? pages[at - 1] : undefined
  const next = at >= 0 ? pages[at + 1] : undefined
  const current = pages[at]
  const description = props.description ?? `${props.title} documentation for OpenCode.`
  const canonical = new URL(docsHref(props.currentSlug), "https://opencode.ai").href
  const contents = props.headings
    .filter((heading) => heading.depth === 2 || heading.depth === 3)
    .map((heading) => ({ id: heading.slug, title: heading.text, level: heading.depth as 2 | 3 }))
  const links = siteLinks(i18n.t, (path) => path)
  const nav = navDefaults.flatMap((entry) => (entry.visible ? links.nav.filter((item) => item.id === entry.id) : []))
  const logo = () => (
    <a href="/" data-slot="logo" data-variant="icon" aria-label={i18n.t("nav.logoAlt")} title={i18n.t("nav.home")}>
      <LogoIcon />
    </a>
  )

  return (
    <html lang="en" dir="ltr">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="description" content={description} />
        <Show when={props.noindex}>
          <meta name="robots" content="noindex" />
        </Show>
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#fbfbfb" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0c0c0c" />
        <meta name="color-scheme" content="light dark" />
        <script type="speculationrules" innerHTML={speculationRules} />
        <link rel="canonical" href={canonical} />
        <link rel="icon" type="image/svg+xml" href={`${base}favicon.svg`} />
        <Show when={props.markdown}>{(href) => <link rel="alternate" type="text/markdown" href={href()} />}</Show>
        <title>{`${props.title} | OpenCode`}</title>
        <link rel="preload" href={interLatin} as="font" type="font/woff2" crossorigin="anonymous" />
        <link rel="preload" href={monoFontLatin} as="font" type="font/woff2" crossorigin="anonymous" />
        <style innerHTML={`${interFaces}\n${monoFontFaces}`} />
        <link rel="stylesheet" href={props.assets.stylesheet} />
      </head>
      <body>
        <div data-site data-page="docs" data-layout="docs" data-theme="system" {...rootAttributes()}>
          <script innerHTML={themeMigration + themeScript(false)} />
          <a href="#content" data-component="skip-link">
            {i18n.t("site.skipToContent")}
          </a>
          <header data-component="topbar">
            {logo()}
            <DocsLockup current={section.title} inline="topbar" />
            <button
              type="button"
              data-slot="search-button"
              data-search-open
              aria-label="Search documentation"
              aria-haspopup="dialog"
            >
              <SearchIcon />
            </button>
            <GitHubLink owner="topbar" />
            <MenuToggle open={false} onToggle={() => undefined} />
          </header>
          <MenuSheet open={false} onClose={() => undefined}>
            <For each={nav}>
              {(item, index) => (
                <li data-nav-id={item.id}>
                  <a
                    href={item.href}
                    target={"external" in item && item.external ? "_blank" : undefined}
                    aria-current={item.id === "docs" ? "page" : undefined}
                  >
                    <span data-slot="index" aria-hidden="true">
                      [<span data-slot="number">{index() + 1}</span>]
                    </span>
                    <span data-slot="label">{item.label}</span>
                    <Show when={"arrow" in item && item.arrow}>
                      <ExternalArrow />
                    </Show>
                    <Show when={"external" in item && item.external}>
                      <NewTab />
                    </Show>
                  </a>
                </li>
              )}
            </For>
          </MenuSheet>

          <div data-slot="frame">
            <aside
              data-component="sidebar"
              data-section-nav
              data-section="nav"
              aria-label={i18n.t("site.landmark.navigation")}
            >
              <DocsLockup current={section.title} inline="sidebar" />
              {logo()}
              <div data-component="section-nav">
                <button type="button" data-slot="section-toggle" aria-expanded="false" aria-controls="section-nav">
                  {/* The page in its section, or the section when the page is named like its title ("Docs" over "Intro"). */}
                  <span>{current && current.title !== props.title ? current.title : section.title}</span>
                  <Chevron />
                </button>
                <div data-slot="section-body" id="section-nav">
                  <DocsNav section={section.title} groups={section.groups} currentSlug={props.currentSlug} />
                </div>
              </div>
            </aside>
            <GitHubLink owner="corner" />

            <main data-component="content" id="content" tabindex={-1}>
              <div data-slot="page">
                <article
                  data-component="docs-article"
                  data-section="article"
                  data-pagefind-body={props.noindex ? undefined : ""}
                  data-pagefind-meta={`title:${props.title}`}
                >
                  <h1 data-pagefind-meta={`section:${section.title}`}>{props.title}</h1>
                  {/* Phones: the Contents rail folded into a bar under the title (Pagefind skips it, build.ts). */}
                  <Show when={contents.length > 0}>
                    <ContentsMenu items={contents} />
                  </Show>
                  {props.children}
                  <footer data-slot="article-footer" data-pagefind-ignore>
                    <Show when={previous || next}>
                      <nav aria-label="Pages" data-component="pagination">
                        <Show when={previous}>
                          {(page) => (
                            <a href={docsHref(page().slug)} rel="prev">
                              <small>Previous</small> {page().title}
                            </a>
                          )}
                        </Show>
                        <Show when={next}>
                          {(page) => (
                            <a href={docsHref(page().slug)} rel="next">
                              <small>Next</small> {page().title}
                            </a>
                          )}
                        </Show>
                      </nav>
                    </Show>
                    <Show when={props.source}>
                      {(source) => (
                        <p data-component="edit-link">
                          <a
                            href={`${config.github.repoUrl}/blob/dev/services/site/src/docs/${source()}`}
                            target="_blank"
                            rel="noopener"
                          >
                            Edit this page on GitHub
                            <NewTab />
                          </a>
                          <button type="button" data-copy-markdown data-funnel-copy="page-markdown" data-state="idle">
                            <span data-slot="copy-labels" aria-hidden="true">
                              <span data-label="idle">Copy as Markdown</span>
                              <span data-label="copied">Copied</span>
                              <span data-label="failed">Failed</span>
                            </span>
                            <span data-slot="sr-only">Copy page as Markdown</span>
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
                  aria-label="Search documentation"
                  aria-haspopup="dialog"
                  aria-keyshortcuts="Meta+K Control+K /"
                >
                  <span>Search</span>
                  <kbd dir="ltr">⌘K</kbd>
                </button>
                <Show when={contents.length > 0}>
                  <OnThisPage items={contents} />
                </Show>
              </div>
            </aside>
          </div>

          <DocsFooter markdown={props.markdown} />
          <DocsSearchDialog />
        </div>
        <script type="module" src={props.assets.script} />
      </body>
    </html>
  )
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
