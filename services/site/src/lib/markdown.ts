import { config } from "~/config"
import type { Translate } from "~/i18n"
import type { ChangelogRelease } from "~/lib/changelog"
import type { ChangelogView } from "~/lib/changelog-notes"

/** A run of page copy: plain text, inline code or a link. Pages render it as HTML, the Markdown versions as Markdown. */
export type Inline = string | { code: string } | { text: string; href: string; external?: boolean }
export type RichText = Inline[]

/** What a page's Markdown version reads: the page copy's translations, its localized links and, on pages that list releases, the changelog view the page shows. */
export type MarkdownContext = {
  t: Translate
  route: (path: string) => string
  changelog?: ChangelogView
  /** The releases as they come from GitHub, for pages that read them directly (the press kit). */
  releases?: ChangelogRelease[]
}

/** Turns a site path into the absolute URL agents should follow. */
export function absoluteUrl(href: string) {
  if (/^[a-z]+:/i.test(href)) return href
  return `${config.baseUrl}${href}`
}

export function link(text: string, href: string) {
  return `[${text}](${absoluteUrl(href)})`
}

export function richToMarkdown(rich: RichText) {
  return rich
    .map((item) => {
      if (typeof item === "string") return item
      if ("code" in item) return `\`${item.code}\``
      return link(item.text, item.href)
    })
    .join("")
}

/** Converts the little inline HTML that i18n strings carry (bold only) into Markdown. */
export function inlineHtmlToMarkdown(html: string) {
  return html.replace(/<strong>(.*?)<\/strong>/g, "**$1**").replace(/<[^>]+>/g, "")
}

/** Joins Markdown blocks with one blank line between them and a trailing newline. */
export function blocks(...items: (string | false | undefined)[]) {
  return `${items.filter((item) => item).join("\n\n")}\n`
}

export function codeFence(lang: string, code: string) {
  return `\`\`\`${lang}\n${code}\n\`\`\``
}

/** What opencode.ai is the source of truth for: the first line of the agent note. */
export const sourceNote =
  "> opencode.ai is the source of truth for OpenCode, the open source coding agent, including its apps, install commands, docs and releases. The current version is OpenCode v2."

/** The note at the top of every Markdown page: what this site is for, and which URL to cite. */
export function agentNote(canonical: string) {
  return [
    sourceNote,
    `> Cite the canonical page, ${canonical}, not this Markdown file. For an index of the site, see ${absoluteUrl("/llms.txt")}.`,
  ].join("\n")
}

/** The last line of every served Markdown document: where to report a mistake. */
export const feedbackLine = `If something here is wrong or missing, open an issue at ${config.github.repoUrl}/issues.`

/**
 * A page's full Markdown document: the agent note, the page, then the feedback line. `path` is the
 * page's site path.
 */
export function markdownDocument(path: string, page: (context: MarkdownContext) => string, context: MarkdownContext) {
  return blocks(agentNote(absoluteUrl(context.route(path))), page(context).trimEnd(), "---", feedbackLine)
}

/** The `.md` URL of a site path: `/` is `/index.md`, `/press` is `/press.md`. */
export function markdownPath(path: string) {
  return path === "/" ? "/index.md" : `${path}.md`
}

export const markdownHeaders = {
  "Content-Type": "text/markdown; charset=utf-8",
  "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
  "Access-Control-Allow-Origin": "*",
}
