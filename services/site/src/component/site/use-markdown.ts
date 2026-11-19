import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import type { ChangelogRelease } from "~/lib/changelog"
import type { ChangelogView } from "~/lib/changelog-notes"
import { markdownDocument, markdownPath, type MarkdownContext } from "~/lib/markdown"
import type { MarkdownPages } from "./markdown-pages"

type MarkdownData = { changelog?: () => ChangelogView | undefined; releases?: () => ChangelogRelease[] }

export { markdownKey } from "./markdown-key"

let loaded: MarkdownPages | undefined
let loading: Promise<MarkdownPages> | undefined

/** The Markdown view's chunk once it has loaded, so later pages show the view without waiting. */
export function markdownPagesLoaded() {
  return loaded
}

/** Loads the Markdown view's chunk (markdown-pages.ts) once. */
export function loadMarkdownPages() {
  loading ??= import("./markdown-pages").then((module) => (loaded = module.markdownPages))
  return loading
}

/**
 * The layout's `markdown` prop for a page: its `.md` URL and the same document that URL serves,
 * built from the Markdown view's chunk once it has loaded. `path` is the page's site path without
 * the locale; `page` builds the page's Markdown, from the chunk's generators or its own; `data` feeds
 * pages that list releases: the changelog view they show, or the releases themselves.
 */
export function useMarkdown(
  path: string,
  page: (context: MarkdownContext, pages: MarkdownPages) => string,
  data: MarkdownData = {},
) {
  const language = useLanguage()
  const context = useMarkdownContext(data)
  return {
    href: language.route(markdownPath(path)),
    source: (pages: MarkdownPages) => markdownDocument(path, (context) => page(context, pages), context()),
  }
}

/** A page's Markdown document right away, from a generator the page already has (the brand rules button). */
export function useMarkdownSource(path: string, page: (context: MarkdownContext) => string, data: MarkdownData = {}) {
  const context = useMarkdownContext(data)
  return () => markdownDocument(path, page, context())
}

function useMarkdownContext(data: MarkdownData) {
  const i18n = useI18n()
  const language = useLanguage()
  return (): MarkdownContext => ({
    t: i18n.t,
    route: language.route,
    changelog: data.changelog?.(),
    releases: data.releases?.(),
  })
}
