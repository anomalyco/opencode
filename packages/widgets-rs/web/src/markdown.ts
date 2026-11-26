// A small Markdown subset rendered to DOM nodes (never HTML strings): paragraphs, headings, lists, block quotes, fenced
// code, rules, and inline code, bold, italics, strikethrough and links (http, https and mailto only).

export function markdown(text: string, doc: Document): DocumentFragment {
  const out = doc.createDocumentFragment()
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  let i = 0
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K) => doc.createElement(tag)
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trimStart().startsWith(fence[1]!)) body.push(lines[i++]!)
      i++
      const pre = el("pre")
      const code = el("code")
      code.textContent = body.join("\n")
      pre.append(code)
      out.append(pre)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const h = el(`h${Math.min(4, heading[1]!.length)}` as "h1")
      inline(heading[2]!.replace(/\s+#+\s*$/, ""), h, doc)
      out.append(h)
      i++
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.append(el("hr"))
      i++
      continue
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*>\s?/, ""))
      const q = el("blockquote")
      q.append(markdown(body.join("\n"), doc))
      out.append(q)
      continue
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (item) {
      const ordered = /\d/.test(item[2]!)
      const list = el(ordered ? "ol" : "ul")
      if (ordered) {
        const start = parseInt(item[2]!, 10)
        if (start !== 1) list.setAttribute("start", String(start))
      }
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]!)
        if (!m || /\d/.test(m[2]!) !== ordered) break
        const parts = [m[3]!]
        i++
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]!))
          parts.push(lines[i++]!.trim())
        const li = el("li")
        const task = /^\[([ xX])\]\s+(.*)$/.exec(parts.join(" "))
        if (task) {
          li.append(task[1] === " " ? "☐ " : "☑ ")
          inline(task[2]!, li, doc)
        } else inline(parts.join(" "), li, doc)
        list.append(li)
      }
      out.append(list)
      continue
    }
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^\s*(```|~~~|#{1,6}\s|>|([-*+]|\d+[.)])\s+)/.test(lines[i]!)
    )
      para.push(lines[i++]!)
    const p = el("p")
    para.forEach((l, n) => {
      if (n > 0) {
        if (/ {2,}$|\\$/.test(para[n - 1]!)) p.append(el("br"))
        else p.append(" ")
      }
      inline(l.replace(/( {2,}|\\)$/, "").trim(), p, doc)
    })
    out.append(p)
  }
  return out
}

const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*([^\s*][\s\S]*?)\*|\b_([^\s_][\s\S]*?)_\b|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/

function inline(text: string, into: Node, doc: Document) {
  let rest = text
  while (rest) {
    const m = INLINE.exec(rest)
    if (!m) {
      into.appendChild(doc.createTextNode(rest))
      return
    }
    if (m.index > 0) into.appendChild(doc.createTextNode(rest.slice(0, m.index)))
    rest = rest.slice(m.index + m[0].length)
    if (m[1]) {
      const code = doc.createElement("code")
      code.textContent = m[2]!.trim() || m[2]!
      into.appendChild(code)
    } else if (m[3] !== undefined || m[4] !== undefined) {
      const b = doc.createElement("strong")
      inline((m[3] ?? m[4])!, b, doc)
      into.appendChild(b)
    } else if (m[5] !== undefined) {
      const s = doc.createElement("s")
      inline(m[5], s, doc)
      into.appendChild(s)
    } else if (m[6] !== undefined || m[7] !== undefined) {
      const e = doc.createElement("em")
      inline((m[6] ?? m[7])!, e, doc)
      into.appendChild(e)
    } else if (m[8] !== undefined) {
      into.appendChild(link(m[9]!, (a) => inline(m[8]!, a, doc), doc))
    } else if (m[10] !== undefined) {
      into.appendChild(link(m[10], (a) => a.append(m[10]!), doc))
    }
  }
}

function link(href: string, fill: (a: HTMLElement) => void, doc: Document): Node {
  const safe = /^(https?:|mailto:)/i.test(href)
  const a = doc.createElement(safe ? "a" : "span")
  if (safe) {
    a.setAttribute("href", href)
    a.setAttribute("target", "_blank")
    a.setAttribute("rel", "noopener noreferrer nofollow")
  }
  fill(a)
  return a
}
