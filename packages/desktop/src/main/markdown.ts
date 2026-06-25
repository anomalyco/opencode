import { marked, type Tokens } from "marked"

const renderer = new marked.Renderer()

renderer.link = ({ href, title, text }: Tokens.Link) => {
  const titleAttr = title ? ` title="${title}"` : ""
  return `<a href="${href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
}

export function parseMarkdown(input: string) {
  return marked(input, {
    renderer,
    breaks: false,
    gfm: true,
  })
}
