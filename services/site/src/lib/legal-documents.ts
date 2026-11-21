import { absoluteUrl, blocks, type MarkdownContext } from "~/lib/markdown"
import { legalDate, legalDatesLine, legalHeadings, legalVersions, type LegalDocumentContent } from "~/lib/legal"
import { privacyPolicy } from "~/lib/legal/privacy-policy"
import { termsOfService } from "~/lib/legal/terms-of-service"

// Every legal document at once, for the legal index, its Markdown, the feed and the sitemap. A
// document's own page imports only its document, so it doesn't load the others.

/** The published legal documents, in the order the legal pages list them. */
export const legalDocuments: LegalDocumentContent[] = [privacyPolicy, termsOfService]

/**
 * Every document the legal pages list. Drafts pending legal review are kept outside the repository
 * until they are approved (test/legal-drafts.test.ts fails if one comes back).
 */
export const legalPages: LegalDocumentContent[] = legalDocuments

/**
 * The legal feed's entries (/legal/feed.xml): one per text version of a published document,
 * newest first.
 */
export function legalFeedEntries() {
  return legalDocuments
    .flatMap((document) => legalVersions(document.path).map((version) => ({ document, version })))
    .sort((a, b) => b.version.date.localeCompare(a.version.date))
    .map(({ document, version }) => ({
      id: `${absoluteUrl(document.path)}#${version.sha}`,
      date: version.date,
      page: absoluteUrl(document.path),
      change: version.first ? version.source : version.diff,
      title: version.first ? `${document.title} published` : `${document.title} changed`,
      summary: version.first
        ? `First version of the ${document.title}${version.effective ? `, effective ${version.effective}` : ""}.`
        : `${version.addedCount} sentences added and ${version.removedCount} removed on ${legalDate(version.date)}${version.effective ? `. The document states the effective date ${version.effective}` : ""}. Commit: ${version.subject}`,
    }))
}

/** The legal index as Markdown: the same documents, descriptions, dates and lines as the page. */
export function legalHubMarkdown(context: MarkdownContext) {
  return blocks(
    "# Legal",
    "The legal documents for the OpenCode website and hosted services.",
    legalPages
      .map(
        (document) =>
          `- [${document.title}](${absoluteUrl(context.route(document.path))}): ${document.description} (${legalDatesLine(document)})`,
      )
      .join("\n"),
    [
      `[Follow changes by RSS](${absoluteUrl("/legal/feed.xml")})`,
      `[Brand and trademark guidelines](${absoluteUrl(context.route("/brand"))})`,
      "[Open source license (MIT)](https://github.com/anomalyco/opencode/blob/dev/LICENSE)",
    ].join(" · "),
  )
}

/**
 * The ⌘K search's entries for the legal documents: each one's title and description, and its h2s
 * and h3s with the text up to the next heading. script/legal-search.ts writes them to
 * component/site/legal-search.json, so the search loads those instead of the documents.
 */
export function legalSearch() {
  return legalDocuments.map((document) => ({
    title: document.title,
    path: document.path,
    description: document.description,
    headings: legalHeadings(document),
  }))
}
