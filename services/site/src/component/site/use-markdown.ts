import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import type { ChangelogRelease } from "~/lib/changelog"
import type { ChangelogView } from "~/lib/changelog-notes"
import { markdownDocument, markdownPath, type MarkdownContext } from "~/lib/markdown"

/**
 * The layout's `markdown` prop for a page: its `.md` URL and the same document that URL serves.
 * `path` is the page's site path without the locale; `data` feeds pages that list releases: the
 * changelog view they show, or the releases themselves.
 */
export function useMarkdown(
  path: string,
  page: (context: MarkdownContext) => string,
  data: { changelog?: () => ChangelogView | undefined; releases?: () => ChangelogRelease[] } = {},
) {
  const i18n = useI18n()
  const language = useLanguage()
  return {
    href: language.route(markdownPath(path)),
    source: () =>
      markdownDocument(path, page, {
        t: i18n.t,
        route: language.route,
        changelog: data.changelog?.(),
        releases: data.releases?.(),
      }),
  }
}
