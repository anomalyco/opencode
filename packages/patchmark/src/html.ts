import type { BlockKind, InlineNode, ListItemNode, MarkdownBlock } from "./types"

export interface HtmlRenderOptions {
  gfm?: boolean
  math?: boolean
}

const DISALLOWED_RAW_HTML_RE =
  /<(\/?)(iframe|noembed|noframes|plaintext|script|style|title|textarea|xmp)(?=[\t\n\f\r />])/gi

export function filterDisallowedRawHtml(raw: string): string {
  return raw.replace(DISALLOWED_RAW_HTML_RE, "&lt;$1$2")
}

export function escapeHtml(text: string): string {
  if (!/[&<>"]/.test(text)) return text
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** Image alt text the way commonmark.js renders it: tags suppressed, text escaped, raw HTML kept */
function renderAlt(nodes: ReadonlyArray<InlineNode>): string {
  let out = ""
  for (const node of nodes) {
    switch (node.type) {
      case "text":
      case "code":
        out += escapeHtml(node.text)
        break
      case "strong":
      case "em":
      case "del":
      case "link":
        out += renderAlt(node.children)
        break
      case "image":
        out += node.children ? renderAlt(node.children) : escapeHtml(node.alt)
        break
      case "math":
        out += escapeHtml(node.source)
        break
      case "br":
        out += "\n"
        break
      case "html_inline":
        out += node.raw
        break
    }
  }
  return out
}

export function renderInlinesToHtml(nodes: ReadonlyArray<InlineNode>, options?: HtmlRenderOptions): string {
  let out = ""
  const gfm = options?.gfm ?? false
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out += escapeHtml(node.text)
        break
      case "strong":
        out += `<strong>${renderInlinesToHtml(node.children, options)}</strong>`
        break
      case "em":
        out += `<em>${renderInlinesToHtml(node.children, options)}</em>`
        break
      case "del":
        out += `<del>${renderInlinesToHtml(node.children, options)}</del>`
        break
      case "code":
        out += `<code>${escapeHtml(node.text)}</code>`
        break
      case "math":
        out += `<span class="math-${node.display ? "display" : "inline"}" data-math-delimiter="${node.delimiter}">${escapeHtml(node.source)}</span>`
        break
      case "link": {
        const titleAttr = node.title ? ` title="${escapeHtml(node.title)}"` : ""
        out += `<a href="${escapeHtml(node.href)}"${titleAttr}>${renderInlinesToHtml(node.children, options)}</a>`
        break
      }
      case "image": {
        const titleAttr = node.title ? ` title="${escapeHtml(node.title)}"` : ""
        const alt = node.children ? renderAlt(node.children) : escapeHtml(node.alt)
        out += `<img src="${escapeHtml(node.src)}" alt="${alt}"${titleAttr} />`
        break
      }
      case "html_inline":
        out += gfm ? filterDisallowedRawHtml(node.raw) : node.raw
        break
      case "br":
        out += "<br />\n"
        break
    }
  }
  return out
}

const blockHtmlCache = new WeakMap<BlockKind, { gfm: boolean; html: string }>()
const paragraphHtmlCache = new WeakMap<BlockKind, { gfm: boolean; tight?: string; loose?: string }>()
const rowHtmlCache = new WeakMap<InlineNode[][], { gfm: boolean; align: string; html: string }>()

const CHECKED = `<input checked="" disabled="" type="checkbox"> `
const UNCHECKED = `<input disabled="" type="checkbox"> `

class HtmlWriter {
  private parts: string[] = []
  private lastOut = "\n"
  constructor(readonly options: HtmlRenderOptions | undefined) {}

  get buffer(): string {
    return this.parts.join("")
  }

  out(s: string) {
    this.parts.push(s)
    this.lastOut = s
  }

  cr() {
    if (this.lastOut !== "\n") this.out("\n")
  }

  block(kind: BlockKind, tight: boolean, prefix = "") {
    const gfm = this.options?.gfm ?? false
    if (kind.type === "paragraph") {
      if (prefix) return this.blockUncached(kind, tight, prefix)
      const hit = paragraphHtmlCache.get(kind)
      const key = tight ? "tight" : "loose"
      let html = hit?.gfm === gfm ? hit[key] : undefined
      if (html === undefined) {
        html = renderInlinesToHtml(kind.inlines, this.options)
        const entry = hit?.gfm === gfm ? hit : { gfm }
        entry[key] = html
        paragraphHtmlCache.set(kind, entry)
      }
      if (tight) {
        this.out(html)
      } else {
        this.cr()
        this.out(`<p>${html}</p>`)
        this.cr()
      }
      return
    }
    if (!tight && !prefix) {
      // kinds of closed blocks are shared across stream frames, so their HTML is too
      const hit = blockHtmlCache.get(kind)
      if (hit && hit.gfm === gfm) {
        this.cr()
        this.out(hit.html)
        this.lastOut = "\n"
        return
      }
      const sub = new HtmlWriter(this.options)
      sub.blockUncached(kind, false, "")
      const html = sub.buffer
      blockHtmlCache.set(kind, { gfm, html })
      this.cr()
      this.out(html)
      this.lastOut = "\n"
      return
    }
    this.blockUncached(kind, tight, prefix)
  }

  blockUncached(kind: BlockKind, tight: boolean, prefix: string) {
    const gfm = this.options?.gfm ?? false
    switch (kind.type) {
      case "paragraph":
        if (tight) {
          this.out(prefix + renderInlinesToHtml(kind.inlines, this.options))
        } else {
          this.cr()
          this.out(`<p>${prefix}${renderInlinesToHtml(kind.inlines, this.options)}</p>`)
          this.cr()
        }
        return
      case "heading":
        this.cr()
        this.out(`<h${kind.level}>${renderInlinesToHtml(kind.inlines, this.options)}</h${kind.level}>`)
        this.cr()
        return
      case "code": {
        let cls = ""
        if (kind.language) {
          const escaped = escapeHtml(kind.language)
          cls = ` class="${escaped.startsWith("language-") ? escaped : `language-${escaped}`}"`
        }
        const defaultBody = kind.source ? (kind.source.endsWith("\n") && !kind.complete ? kind.source : `${kind.source}\n`) : ""
        const body = kind.htmlLiteral !== undefined ? kind.htmlLiteral : defaultBody
        this.cr()
        this.out(`<pre><code${cls}>${escapeHtml(body)}</code></pre>`)
        this.cr()
        return
      }
      case "mermaid": {
        const defaultBody = kind.source ? (kind.source.endsWith("\n") && !kind.complete ? kind.source : `${kind.source}\n`) : ""
        const body = kind.htmlLiteral !== undefined ? kind.htmlLiteral : defaultBody
        this.cr()
        this.out(`<pre><code class="language-mermaid">${escapeHtml(body)}</code></pre>`)
        this.cr()
        return
      }
      case "math":
        this.cr()
        this.out(`<div class="math-block" data-math-delimiter="${kind.delimiter}">${escapeHtml(kind.source)}</div>`)
        this.cr()
        return
      case "blockquote":
        this.cr()
        this.out("<blockquote>")
        this.cr()
        for (const child of kind.blocks) this.block(child, false)
        this.cr()
        this.out("</blockquote>")
        this.cr()
        return
      case "list": {
        const tag = kind.ordered ? "ol" : "ul"
        const startAttr = kind.ordered && kind.start !== undefined && kind.start !== 1 ? ` start="${kind.start}"` : ""
        this.cr()
        this.out(`<${tag}${startAttr}>`)
        this.cr()
        for (const item of kind.items) this.item(item, kind.tight)
        this.cr()
        this.out(`</${tag}>`)
        this.cr()
        return
      }
      case "table": {
        this.cr()
        let out = "<table>\n<thead>\n<tr>\n"
        for (let c = 0; c < kind.headers.length; c++) {
          const align = kind.align[c]
          out += `<th${align ? ` align="${align}"` : ""}>${renderInlinesToHtml(kind.headers[c]!, this.options)}</th>\n`
        }
        out += "</tr>\n</thead>\n"
        if (kind.rows.length > 0) {
          out += "<tbody>\n"
          const alignKey = kind.align.join(",") + ":" + kind.headers.length
          for (const row of kind.rows) {
            const hit = rowHtmlCache.get(row)
            if (hit && hit.gfm === gfm && hit.align === alignKey) {
              out += hit.html
              continue
            }
            let rowHtml = "<tr>\n"
            for (let c = 0; c < kind.headers.length; c++) {
              const align = kind.align[c]
              rowHtml += `<td${align ? ` align="${align}"` : ""}>${renderInlinesToHtml(row[c] ?? [], this.options)}</td>\n`
            }
            rowHtml += "</tr>\n"
            rowHtmlCache.set(row, { gfm, align: alignKey, html: rowHtml })
            out += rowHtml
          }
          out += "</tbody>\n"
        }
        out += "</table>"
        this.out(out)
        this.cr()
        return
      }
      case "html_block":
        this.cr()
        this.out(gfm ? filterDisallowedRawHtml(kind.raw) : kind.raw)
        this.cr()
        return
      case "hr":
        this.cr()
        this.out("<hr />")
        this.cr()
        return
      case "group":
        for (const child of kind.blocks) this.block(child, false)
        return
    }
  }

  item(item: ListItemNode, tight: boolean) {
    const checkbox = item.checked === true ? CHECKED : item.checked === false ? UNCHECKED : ""
    this.out("<li>")
    for (let i = 0; i < item.blocks.length; i++) {
      this.block(item.blocks[i]!, tight, i === 0 ? checkbox : "")
    }
    if (item.blocks.length === 0 && checkbox) this.out(checkbox.trimEnd())
    this.out("</li>")
    this.cr()
  }
}

export function renderBlockKindToHtml(kind: BlockKind, options?: HtmlRenderOptions): string {
  const writer = new HtmlWriter(options)
  writer.block(kind, false)
  return writer.buffer
}

export function renderBlocksToHtml(blocks: ReadonlyArray<MarkdownBlock>, options?: HtmlRenderOptions): string {
  let out = ""
  for (const b of blocks) {
    out += options ? renderBlockKindToHtml(b.kind, options) : (b.html ?? renderBlockKindToHtml(b.kind))
  }
  return out
}
