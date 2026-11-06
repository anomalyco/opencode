import { absoluteUrl, blocks, type MarkdownContext } from "~/lib/markdown"
import { legalHistory, type LegalVersion } from "~/lib/legal/history"
import { legalSummaries } from "~/lib/legal/summaries"

/**
 * A legal document as a small HTML tree: `[tag, attributes, ...children]` or text. The page renders
 * it as HTML and the Markdown version serializes it, so both read from one copy. Site-relative
 * `href`s (starting with `/`) are localized when rendered.
 */
export type LegalNode = string | [tag: string, attributes: Record<string, string>, ...children: LegalNode[]]

export type LegalDocumentContent = {
  path: string
  title: string
  /** The page's `<title>`, 50–60 characters. */
  metaTitle: string
  effective: string
  /** The meta and share description, 120–160 characters. */
  description: string
  /** Not reviewed by legal yet: marked as a draft, never indexed, and listed only with Settings › Legal drafts. */
  draft?: boolean
  body: LegalNode[]
}

/** The text versions of a document, newest first (from git, see script/legal-history.ts). */
export function legalVersions(path: string): LegalVersion[] {
  return (legalHistory as Record<string, LegalVersion[]>)[path] ?? []
}

/** The latest text change, when its date is not the effective date the document states. */
export function legalTextChanged(document: LegalDocumentContent) {
  const latest = legalVersions(document.path)[0]
  if (!latest || latest.first || latest.effective === legalDate(latest.date)) return
  return latest
}

/** The dates line under a document's title, as the page shows it. */
export function legalDatesLine(document: LegalDocumentContent) {
  const changed = legalTextChanged(document)
  return changed ? `${document.effective} · Text last changed ${legalDate(changed.date)}` : document.effective
}

/** A YYYY-MM-DD date as the documents write theirs: "Aug 24, 2026". */
export function legalDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

export function legalMarkdown(document: LegalDocumentContent, context: MarkdownContext) {
  const page = absoluteUrl(context.route(document.path))
  const href = (value: string) => {
    if (value.startsWith("#")) return `${page}${value}`
    if (value.startsWith("/")) return absoluteUrl(context.route(value))
    return value
  }

  const inline = (nodes: LegalNode[]): string =>
    nodes
      .map((node) => {
        if (typeof node === "string") return node
        const [tag, attributes] = node
        const children = childrenOf(node)
        if (tag === "a") return `[${inline(children)}](${href(attributes.href)})`
        if (tag === "strong") return `**${inline(children).trim()}**`
        return inline(children)
      })
      .join("")

  const list = (node: LegalElement, indent: string): string =>
    elements(node)
      .map((item, index) => {
        const marker = node[0] === "ol" ? `${index + 1}.` : "-"
        const text = inline(childrenOf(item).filter((child) => !isList(child))).trim()
        const nested = elements(item)
          .filter(isList)
          .map((child) => list(child, `${indent}  `))
        return [`${indent}${marker} ${text}`, ...nested].join("\n")
      })
      .join("\n")

  // Tables can't hold lists in Markdown, so a cell's list items are joined with semicolons.
  const cell = (nodes: LegalNode[]): string =>
    nodes
      .map((node) => {
        if (typeof node === "string") return node
        if (isList(node))
          return elements(node)
            .map((item) => cell(childrenOf(item)).trim())
            .join("; ")
        if (node[0] === "strong") return `**${cell(childrenOf(node)).trim()}** `
        return inline([node])
      })
      .join("")
      .replace(/\|/g, "\\|")
      .replace(/\s+/g, " ")
      .trim()

  const table = (node: LegalElement) => {
    const rows = elements(node)
      .flatMap(elements)
      .map((row) => elements(row).map((item) => cell(childrenOf(item))))
    return [rows[0], rows[0].map(() => "---"), ...rows.slice(1)].map((row) => `| ${row.join(" | ")} |`).join("\n")
  }

  const block = (node: LegalNode): string => {
    if (typeof node === "string") return node.trim()
    const tag = node[0]
    const children = childrenOf(node)
    if (tag === "h2") return `## ${inline(children)}`
    if (tag === "h3") return `### ${inline(children)}`
    if (tag === "h4") return `#### ${inline(children)}`
    if (tag === "ul" || tag === "ol") return list(node, "")
    if (tag === "table") return table(node)
    // Preformatted text (security.txt) stays verbatim in a fence, so its "#" comments aren't headings.
    if (tag === "pre") return ["```text", inline(children).replace(/\n+$/, ""), "```"].join("\n")
    if (tag === "div") return children.map(block).join("\n\n")
    return inline(children).trim()
  }

  const summary = legalSummaries[document.path]
  return blocks(
    `# ${document.title}`,
    legalDatesLine(document),
    summary ? ["> **Summary**", ">", ...summary.map((point) => `> - ${inline(point).trim()}`)].join("\n") : undefined,
    ...document.body.filter(published).map(block),
  )
}

type LegalElement = Exclude<LegalNode, string>

function childrenOf(node: LegalElement) {
  const [, , ...children] = node
  return children.filter(published)
}

/**
 * False for a note to the legal reviewers in a draft (marked `data-review`). Readers never see
 * these: the page shows them only with Settings › Legal review notes, and the Markdown leaves them
 * out.
 */
export function published(node: LegalNode) {
  return typeof node === "string" || node[1]["data-review"] === undefined
}

function legalText(node: LegalNode): string {
  if (typeof node === "string") return node
  const [, , ...children] = node
  return children.filter(published).map(legalText).join("")
}

/** Each h2 and h3 of a legal document, with the text up to the next heading. */
export function legalHeadings(document: LegalDocumentContent) {
  return document.body
    .filter(published)
    .reduce<{ id: string; title: string; body: string; path: string; document: string }[]>((acc, node) => {
      if (typeof node !== "string" && (node[0] === "h2" || node[0] === "h3") && node[1].id) {
        acc.push({ id: node[1].id, title: legalText(node), body: "", path: document.path, document: document.title })
        return acc
      }
      const last = acc.at(-1)
      if (last && last.body.length < 600) last.body = `${last.body} ${legalText(node)}`.slice(0, 600)
      return acc
    }, [])
}

function elements(node: LegalElement) {
  return childrenOf(node).filter((child) => typeof child !== "string")
}

function isList(node: LegalNode): node is LegalElement {
  return typeof node !== "string" && (node[0] === "ul" || node[0] === "ol")
}
