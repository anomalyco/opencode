import { translator } from "~/i18n"
import { brandMarkdown } from "~/lib/brand-content"
import type { ChangelogRelease } from "~/lib/changelog"
import { loadChangelog } from "~/lib/changelog-releases"
import { changelogEntryPageMarkdown, changelogMarkdown } from "~/lib/changelog-markdown"
import { areaKeys, changelogEntryView, changelogView, type ChangelogView } from "~/lib/changelog-notes"
import { fontMarkdown } from "~/lib/font-content"
import { homeMarkdown } from "~/lib/home-markdown"
import { route, type Locale } from "~/lib/language"
import { legalMarkdown } from "~/lib/legal"
import { legalHubMarkdown } from "~/lib/legal-documents"
import { privacyPolicy } from "~/lib/legal/privacy-policy"
import { termsOfService } from "~/lib/legal/terms-of-service"
import { markdownDocument, type MarkdownContext } from "~/lib/markdown"
import { pressMarkdown } from "~/lib/press-content"
import { extensionMarkdown, productMarkdown, productsMarkdown } from "~/lib/product-markdown"
import { extensionPages } from "~/component/site/extension-data"
import { allProductPages, productAreas, productDetails } from "~/component/site/product-data"

type PageMarkdown = {
  title: string
  description: string
  markdown: (context: MarkdownContext) => string
  /** Lists releases: the changelog view the page shows, from the releases and the page's query. */
  changelog?: (releases: ChangelogRelease[], query: URLSearchParams) => ChangelogView
  /** Reads the releases themselves. */
  releases?: boolean
  /** The text is English in every locale, so the English URL is canonical. */
  englishOnly?: boolean
  /** A legal draft pending review: served with noindex and left out of llms-full.txt. */
  draft?: boolean
}

/**
 * Every site page with a Markdown version, by its path without the locale. The `.md` URLs, content
 * negotiation, llms.txt and llms-full.txt all read this list.
 */
export const pageMarkdown: Record<string, PageMarkdown> = {
  "/": { title: "Home", description: "What OpenCode is, its apps, features and FAQ", markdown: homeMarkdown },
  "/product": {
    title: "Product",
    description: "Every OpenCode product and extension, more open source from Anomaly, and every download",
    markdown: productsMarkdown,
  },
  ...Object.fromEntries(
    allProductPages.map((product) => {
      const filter = productAreas[product.slug]
      return [
        `/${product.slug}`,
        {
          title: product.name,
          description: product.slug === "mobile" ? productDetails.mobile.description : product.body,
          markdown: productMarkdown(product.slug),
          changelog: filter
            ? (releases: ChangelogRelease[]) => changelogView(releases, { filter, size: 3 })
            : undefined,
        },
      ]
    }),
  ),
  ...Object.fromEntries(
    extensionPages.map((extension) => [
      extension.product ? `/product/${extension.slug}` : `/extensions/${extension.slug}`,
      { title: extension.name, description: extension.body, markdown: extensionMarkdown(extension.slug) },
    ]),
  ),
  "/changelog": {
    title: "Changelog",
    description: "Release notes for every OpenCode release",
    markdown: changelogMarkdown,
    changelog: (releases, query) =>
      changelogView(releases, { page: Number(query.get("page") ?? 1) || 1, filter: areaKeys(query.getAll("area")) }),
  },
  "/press": {
    title: "Press",
    description: "Boilerplate, facts, media, latest releases, logos and press contacts",
    markdown: pressMarkdown,
    releases: true,
  },
  "/brand": { title: "Brand", description: "Logos, wordmarks, colors and usage rules", markdown: brandMarkdown },
  "/font": {
    title: "Font",
    description: "The OpenCode font, how its six letters are built, and how to download it",
    markdown: fontMarkdown,
    englishOnly: true,
  },
  "/legal": {
    title: "Legal",
    description: "Every legal document, with a description and its dates",
    markdown: legalHubMarkdown,
    englishOnly: true,
  },
  [privacyPolicy.path]: {
    title: privacyPolicy.title,
    description: "How OpenCode collects, uses and shares personal data",
    markdown: (context) => legalMarkdown(privacyPolicy, context),
    englishOnly: true,
  },
  [termsOfService.path]: {
    title: termsOfService.title,
    description: "The terms that govern the OpenCode website and hosted services",
    markdown: (context) => legalMarkdown(termsOfService, context),
    englishOnly: true,
  },

}

/** A page's Markdown version: one of the pages above, or a release's page, `/changelog/<tag>`. */
export function findPageMarkdown(path: string): PageMarkdown | undefined {
  if (path in pageMarkdown) return pageMarkdown[path]
  const tag = path.match(/^\/changelog\/(v\d[\w.+-]*)$/)?.[1]
  if (!tag) return
  return {
    title: `Changelog ${tag}`,
    description: `Release notes for OpenCode ${tag}`,
    markdown: changelogEntryPageMarkdown,
    changelog: (releases) => changelogEntryView(releases, tag),
  }
}

/** The context a page's Markdown reads on the server, with the changelog loaded only for pages that list releases. */
export async function markdownContext(
  locale: Locale,
  page?: PageMarkdown,
  query = new URLSearchParams(),
): Promise<MarkdownContext> {
  const releases = page?.changelog || page?.releases ? (await loadChangelog()).releases : []
  return {
    t: translator(locale),
    route: (path) => route(locale, path),
    changelog: page?.changelog?.(releases, query),
    releases: page?.releases ? releases : undefined,
  }
}

/**
 * The full Markdown document for a site path, or undefined when the page has no Markdown version
 * (or is a release page for a tag the changelog doesn't have).
 */
export async function renderPageMarkdown(path: string, locale: Locale, query?: URLSearchParams) {
  const page = findPageMarkdown(path)
  if (!page) return
  const context = await markdownContext(locale, page, query)
  if (page.markdown === changelogEntryPageMarkdown && context.changelog?.ok && !context.changelog.entries[0]) return
  return markdownDocument(path, page.markdown, context)
}
