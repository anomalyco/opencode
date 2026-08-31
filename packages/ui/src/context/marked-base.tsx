import { Marked } from "marked"

export function createMarkdownBase() {
  return new Marked({
    renderer: {
      link({ href, title, text }) {
        const titleAttr = title ? ` title="${title}"` : ""
        return `<a href="${href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
      },
    },
  })
}

let smallParser: Marked | undefined

export function parseSmallMarkdown(text: string) {
  // Any possible KaTeX delimiter stays on the worker, including escaped ones.
  if (text.length > 1024 || text.includes("\\(") || text.includes("$$")) return
  const parser = (smallParser ??= createMarkdownBase())
  const tokens = parser.lexer(text)
  let code = false
  parser.walkTokens(tokens, (token) => {
    if (token.type === "code") code = true
  })
  if (code) return
  return parser.parser(tokens)
}
