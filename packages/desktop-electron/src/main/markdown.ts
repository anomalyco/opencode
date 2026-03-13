import { marked, type Tokens } from "marked"

const renderer = new marked.Renderer()

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

const SAFE_URL_PATTERN = /^(?:https?|mailto|tel):/i

renderer.link = ({ href, title, text }: Tokens.Link) => {
  if (!SAFE_URL_PATTERN.test(href)) {
    return `<span>${text}</span>`
  }
  const safeHref = escapeHtml(href)
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ""
  return `<a href="${safeHref}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
}

export function parseMarkdown(input: string) {
  return marked(input, {
    renderer,
    breaks: false,
    gfm: true,
  })
}
