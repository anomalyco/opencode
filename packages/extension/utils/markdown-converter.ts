import TurndownService from "turndown"

const turndownService = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  fence: "```",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
  linkReferenceStyle: "full",
})

turndownService.addRule("fencedCodeBlock", {
  filter: (node, options) => {
    return (
      options.codeBlockStyle === "fenced" &&
      node.nodeName === "PRE" &&
      node.firstChild !== null &&
      node.firstChild.nodeName === "CODE"
    )
  },
  replacement: (content, node, options) => {
    const codeNode = node.firstChild as HTMLElement
    const className = codeNode.getAttribute("class") || ""
    const languageMatch = className.match(/language-(\w+)/)
    const language = languageMatch ? languageMatch[1] : ""
    const code = codeNode.textContent || ""
    const fence = options.fence || "```"
    return `\n\n${fence}${language}\n${code}\n${fence}\n\n`
  },
})

turndownService.addRule("images", {
  filter: "img",
  replacement: (content, node) => {
    const img = node as HTMLImageElement
    const alt = img.alt || ""
    const src = img.src || ""
    const title = img.title ? ` "${img.title}"` : ""
    if (!src) return ""
    return `![${alt}](${src}${title})`
  },
})

turndownService.remove(["script", "style", "noscript", "iframe", "canvas"])

turndownService.addRule("tableCell", {
  filter: ["th", "td"],
  replacement: (content) => {
    return ` ${content.trim().replace(/\n/g, " ")} |`
  },
})

turndownService.addRule("tableRow", {
  filter: "tr",
  replacement: (content, node) => {
    const cells = content.trim()
    if (!cells) return ""

    const parent = node.parentNode
    const isHeader = parent?.nodeName === "THEAD"

    let result = `|${cells}\n`

    if (isHeader) {
      const cellCount = (node as HTMLTableRowElement).cells.length
      const separator = "|" + " --- |".repeat(cellCount) + "\n"
      result += separator
    }

    return result
  },
})

export function htmlToMarkdown(html: string): string {
  return turndownService.turndown(html)
}

export function elementToMarkdown(element: HTMLElement): string {
  return turndownService.turndown(element)
}

export function formatCapturedContent(options: {
  title: string
  url: string
  content: string
  type: "page" | "selection"
}): string {
  const timestamp = new Date().toLocaleString()

  if (options.type === "selection") {
    return `> Selected from [${options.title}](${options.url})\n\n${options.content}`
  }

  return `# ${options.title}\n\n> **Source**: ${options.url}\n> **Captured**: ${timestamp}\n\n${options.content}`
}

export function formatScreenshot(options: { title: string; dataUrl: string }): string {
  return `![Screenshot of ${options.title}](${options.dataUrl})`
}

export { turndownService }
