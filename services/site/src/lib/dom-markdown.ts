import { absoluteUrl, blocks, codeFence } from "~/lib/markdown"

const INLINE = new Set([
  "A",
  "ABBR",
  "B",
  "BR",
  "CODE",
  "EM",
  "I",
  "KBD",
  "LABEL",
  "MARK",
  "S",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TIME",
  "IMG",
])
const SKIP = new Set([
  "NAV",
  "SCRIPT",
  "STYLE",
  "SVG",
  "VIDEO",
  "AUDIO",
  "CANVAS",
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "NOSCRIPT",
  "TEMPLATE",
  "IFRAME",
])

/**
 * A page's rendered content as Markdown, for the Markdown view on pages without a hand-written
 * version. Hidden and decorative parts (aria-hidden, screen-reader-only text, buttons, media, tab
 * lists) are left out.
 */
export function domMarkdown(root: Element) {
  return blocks(...block(root)).replace(/\n{3,}/g, "\n\n")
}

function block(element: Element): string[] {
  if (skipped(element)) return []
  const tag = element.tagName
  if (/^H[1-6]$/.test(tag)) return [`${"#".repeat(Number(tag[1]))} ${inline(element)}`]
  if (tag === "PRE") {
    const lang =
      element.getAttribute("data-lang") ?? /language-(\S+)/.exec(element.querySelector("code")?.className ?? "")?.[1]
    return [codeFence(lang ?? "", (element.textContent ?? "").replace(/\n$/, ""))]
  }
  if (tag === "UL" || tag === "OL") {
    const items = [...element.children]
      .filter((item) => item.tagName === "LI" && !skipped(item))
      .map((item, index) => `${tag === "OL" ? `${index + 1}.` : "-"} ${flat(item)}`)
    return items.length ? [items.join("\n")] : []
  }
  if (tag === "TABLE") return table(element)
  if (tag === "BLOCKQUOTE") return [flat(element).replace(/^/gm, "> ")]
  if (tag === "HR") return ["---"]
  if ((INLINE.has(tag) || inlineElement(element)) && ![...element.children].some((child) => !inlineElement(child))) {
    const text = inline(element)
    return text ? [text] : []
  }

  // A container: block children become their own blocks; runs of inline content become paragraphs.
  const out: string[] = []
  let run: Node[] = []
  const flush = () => {
    const text = run.map(inlineNode).join("").replace(/\s+/g, " ").trim()
    if (text) out.push(text)
    run = []
  }
  for (const node of element.childNodes) {
    if (node instanceof Element && !inlineElement(node)) {
      flush()
      out.push(...block(node))
      continue
    }
    if (node instanceof Element && node.tagName === "A" && [...node.children].some((child) => !inlineElement(child))) {
      flush()
      const text = inline(node)
      if (text) out.push(text)
      continue
    }
    run.push(node)
  }
  flush()
  return out
}

/** A list item or quote on one line, even when its content is split across block elements. */
function flat(element: Element) {
  return block(element).join(" ").replace(/\s+/g, " ").trim()
}

function inline(element: Element) {
  return inlineNode(element).replace(/\s+/g, " ").trim()
}

function inlineNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ""
  if (!(node instanceof Element) || skipped(node)) return ""
  // Block-level children inside an inline run (a title above its description) keep a space between.
  const inner = () =>
    [...node.childNodes]
      .map((child) =>
        child instanceof Element && !inlineElement(child) ? ` ${inlineNode(child)} ` : inlineNode(child),
      )
      .join("")
  if (node.tagName === "BR") return "\n"
  if (node.tagName === "IMG") {
    const alt = node.getAttribute("alt")
    const src = node.getAttribute("src") ?? ""
    return alt && !src.startsWith("data:") ? `![${alt}](${absoluteUrl(src)})` : ""
  }
  if (node.tagName === "CODE" || node.tagName === "KBD") return `\`${node.textContent ?? ""}\``
  if (node.tagName === "STRONG" || node.tagName === "B") return wrap("**", inner())
  if (node.tagName === "EM" || node.tagName === "I") return wrap("_", inner())
  if (node.tagName === "A") {
    const text = inner().replace(/\s+/g, " ").trim()
    const href = node.getAttribute("href")
    if (!text || !href || href.startsWith("#") || href.startsWith("data:")) return text
    return `[${text}](${absoluteUrl(absoluteHref(href))})`
  }
  return inner()
}

function table(element: Element) {
  const rows = [...element.querySelectorAll("tr")].map((row) =>
    [...row.children].map((cell) => inline(cell).replace(/\|/g, "\\|")),
  )
  if (!rows.length) return []
  const head = `| ${rows[0].join(" | ")} |`
  const rule = `| ${rows[0].map(() => "---").join(" | ")} |`
  return [[head, rule, ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`)].join("\n")]
}

/** Inline by the page's own styles, so a title and description stacked with CSS read as blocks. */
function inlineElement(element: Element) {
  const display = getComputedStyle(element).display
  if (display === "contents") return INLINE.has(element.tagName)
  return display.startsWith("inline")
}

function skipped(element: Element) {
  return (
    SKIP.has(element.tagName) ||
    getComputedStyle(element).display === "none" ||
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-hidden") === "true" ||
    element.getAttribute("data-slot") === "sr-only" ||
    element.getAttribute("role") === "tablist"
  )
}

/** Keeps the surrounding spaces outside the markers, so "** bold **" never happens. */
function wrap(marker: string, text: string) {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)
  if (!match?.[2]) return text
  return `${match[1]}${marker}${match[2]}${marker}${match[3]}`
}

function absoluteHref(href: string) {
  if (/^[a-z]+:/i.test(href)) return href
  const url = new URL(href, location.href)
  return `${url.pathname}${url.search}${url.hash}`
}
