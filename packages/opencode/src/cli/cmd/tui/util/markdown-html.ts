import { Renderer, marked } from "marked"
import type { Tokens } from "marked"

class CustomRenderer extends Renderer {
  // Inline styles for Google Docs compatibility
  override strong({ tokens }: Tokens.Strong): string {
    return `<strong style="font-weight: bold;">${this.parser.parseInline(tokens)}</strong>`
  }

  override em({ tokens }: Tokens.Em): string {
    return `<em style="font-style: italic;">${this.parser.parseInline(tokens)}</em>`
  }

  override codespan({ text }: Tokens.Codespan): string {
    return `<code style="font-family: monospace; background-color: #f0f0f0; padding: 2px 4px; border-radius: 3px;">${escapeHtml(text)}</code>`
  }

  override code({ text }: Tokens.Code): string {
    return `<pre style="font-family: monospace; background-color: #f5f5f5; padding: 1em; border-radius: 4px; overflow-x: auto; white-space: pre-wrap;"><code>${escapeHtml(text)}</code></pre>`
  }

  override link({ href, title, tokens }: Tokens.Link): string {
    const text = this.parser.parseInline(tokens)
    return `<a href="${href}" style="color: #0066cc; text-decoration: underline;"${title ? ` title="${title}"` : ""}>${text}</a>`
  }

  override heading({ tokens, depth }: Tokens.Heading): string {
    const sizes = ["2em", "1.5em", "1.25em", "1em", "0.875em", "0.75em"]
    const text = this.parser.parseInline(tokens)
    return `<h${depth} style="font-size: ${sizes[depth - 1]}; font-weight: bold; margin: 0.5em 0;">${text}</h${depth}>`
  }

  override list(token: Tokens.List): string {
    const tag = token.ordered ? "ol" : "ul"
    const body = token.items.map((item) => this.listitem(item)).join("")
    return `<${tag} style="margin: 0.5em 0; padding-left: 1.5em;">${body}</${tag}>`
  }

  override listitem(item: Tokens.ListItem): string {
    const text = this.parser.parse(item.tokens)
    return `<li>${text}</li>`
  }

  override blockquote({ tokens }: Tokens.Blockquote): string {
    const text = this.parser.parse(tokens)
    return `<blockquote style="border-left: 3px solid #ccc; padding-left: 1em; margin: 0.5em 0; color: #666;">${text}</blockquote>`
  }

  override paragraph({ tokens }: Tokens.Paragraph): string {
    const text = this.parser.parseInline(tokens)
    return `<p style="margin: 0.5em 0;">${text}</p>`
  }

  override table(token: Tokens.Table): string {
    const header = token.header.map((cell) => this.tablecell(cell)).join("")
    const headerRow = `<tr>${header}</tr>`
    const bodyRows = token.rows
      .map((row) => {
        const cells = row.map((cell) => this.tablecell(cell)).join("")
        return `<tr>${cells}</tr>`
      })
      .join("")
    return `<table style="border-collapse: collapse; margin: 0.5em 0;"><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table>`
  }

  override tablecell(token: Tokens.TableCell): string {
    const tag = token.header ? "th" : "td"
    const style = "border: 1px solid #ddd; padding: 8px;"
    const text = this.parser.parseInline(token.tokens)
    return `<${tag} style="${style}">${text}</${tag}>`
  }

  override hr(): string {
    return `<hr style="border: none; border-top: 1px solid #ccc; margin: 1em 0;">`
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function markdownToHtml(markdown: string): string {
  const renderer = new CustomRenderer()
  return marked(markdown, { renderer, async: false }) as string
}
