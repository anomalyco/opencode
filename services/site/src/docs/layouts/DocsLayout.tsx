import { Show, type JSX } from "solid-js"
import { base } from "../config"
import { DocsFooter } from "../components/DocsFooter"
import { DocsHeader } from "../components/DocsHeader"
import { DocsSidebar } from "../components/DocsSidebar"
import { DocsTableOfContents } from "../components/DocsTableOfContents"
import { docsHref, getDocsSection } from "../lib/navigation"
import type { DocsHeading } from "../rehype-headings"

/** The URLs of the docs' stylesheet (styles/global.css) and browser script (client.ts). */
export type DocsAssets = { stylesheet: string; script: string }

// Before first paint: the saved theme, else the system's, and the toggle. Inline so pages never flash.
const themeScript = `
const applyTheme = () => {
  const theme =
    localStorage.getItem("docs-theme") ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#ffffff" : "#000000")
}

applyTheme()
matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyTheme)
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element) || !event.target.closest("[data-theme-toggle]")) return
  localStorage.setItem("docs-theme", document.documentElement.dataset.theme === "light" ? "dark" : "light")
  applyTheme()
})
`

// Pages load as plain documents (no client router). The browser prerenders a docs link once the
// pointer rests on it, and global.css turns on cross-document view transitions, so a click shows the
// next page at once, without a blank frame.
const speculationRules = JSON.stringify({
  prerender: [{ where: { href_matches: `${base}*` }, eagerness: "moderate" }],
})

export function DocsLayout(props: {
  title: string
  description?: string
  currentSlug: string
  headings: DocsHeading[]
  showTableOfContents?: boolean
  fullWidth?: boolean
  noindex?: boolean
  assets: DocsAssets
  children: JSX.Element
}) {
  const section = getDocsSection(props.currentSlug)
  const description = props.description ?? `${props.title} documentation for OpenCode.`
  const canonical = new URL(docsHref(props.currentSlug), "https://opencode.ai").href
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={description} />
        <Show when={props.noindex}>
          <meta name="robots" content="noindex" />
        </Show>
        <meta name="theme-color" content="#000000" />
        <script innerHTML={themeScript} />
        <script type="speculationrules" innerHTML={speculationRules} />
        <link rel="canonical" href={canonical} />
        <link rel="icon" type="image/svg+xml" href={`${base}favicon.svg`} />
        <title>{`${props.title} | OpenCode`}</title>
        <link rel="stylesheet" href={props.assets.stylesheet} />
      </head>
      <body>
        <a class="skip-link" href="#docs-content">
          Skip to content
        </a>
        <DocsHeader currentSlug={props.currentSlug} />
        <Show
          when={!props.fullWidth}
          fallback={
            <main id="docs-content" class="full-width-content">
              {props.children}
            </main>
          }
        >
          <details class="mobile-navigation">
            <summary>{section.title} navigation</summary>
            <DocsSidebar groups={section.groups} currentSlug={props.currentSlug} />
          </details>
          <div class="docs-frame">
            <aside class="sidebar-column">
              <DocsSidebar groups={section.groups} currentSlug={props.currentSlug} />
            </aside>
            <main id="docs-content">
              <article
                class="prose"
                data-pagefind-body={props.noindex ? undefined : ""}
                data-pagefind-meta={`title:${props.title}`}
              >
                <h1>
                  {props.title}
                  <button type="button" aria-label="Copy page as Markdown" data-copy-markdown data-pagefind-ignore>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      aria-hidden="true"
                    >
                      <rect x="8" y="8" width="13" height="13" rx="2" />
                      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
                    </svg>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      aria-hidden="true"
                    >
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                  </button>
                </h1>
                {props.children}
              </article>
            </main>
            <aside class="toc-column">
              <Show when={props.showTableOfContents !== false}>
                <DocsTableOfContents headings={props.headings} />
              </Show>
            </aside>
          </div>
        </Show>
        <DocsFooter />
        <script type="module" src={props.assets.script} />
      </body>
    </html>
  )
}
