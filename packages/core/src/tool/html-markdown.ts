import { Parser } from "htmlparser2"

const omitted = new Set(["script", "style", "noscript", "iframe", "object", "embed", "meta", "link", "template"])
const blocks = new Set([
  "address",
  "article",
  "aside",
  "details",
  "dialog",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "header",
  "main",
  "nav",
  "p",
  "section",
  "summary",
])

type Frame = {
  tag: string
  suppressed: boolean
  link?: { href: string; title?: string }
  marker?: { index: number; block: number; value: string }
  code?: { inline: boolean; text: string; language?: string }
  list?: { ordered: boolean; next: number }
  table?: { cells: number; header: boolean; rows: number }
  cell?: { start: number }
}

export function convertHTMLToMarkdown(html: string) {
  if (hasPathologicalDepth(html)) return extractPathologicalText(html)
  const output: string[] = []
  const stack: Frame[] = []
  let pendingSpace = false
  let last = ""
  let quoteDepth = 0
  let needsQuotePrefix = false
  let blockCount = 0
  let listDepth = 0
  let activeCode: NonNullable<Frame["code"]> | undefined
  let activeTable: NonNullable<Frame["table"]> | undefined
  let tableDepth = 0
  const raw: string[] = []

  const append = (value: string) => {
    if (!value) return
    output.push(value)
    last = value.at(-1) ?? last
  }
  const prefixQuote = () => {
    if (!needsQuotePrefix || quoteDepth === 0) return
    append(`${"> ".repeat(Math.min(8, quoteDepth))}`)
    needsQuotePrefix = false
  }
  const flushSpace = () => {
    if (!pendingSpace) return
    const marker = stack.at(-1)?.marker
    if (marker && output.length === marker.index + 1 && last !== " " && last !== "\n") {
      output[marker.index] = ` ${output[marker.index]}`
      pendingSpace = false
      return
    }
    if (last && last !== "\n" && last !== " ") append(" ")
    pendingSpace = false
  }
  const inline = (value: string, open = false) => {
    if (open) flushSpace()
    prefixQuote()
    append(value)
  }
  const block = () => {
    pendingSpace = false
    append("\n\n")
    blockCount++
    needsQuotePrefix = quoteDepth > 0
  }
  const text = (value: string) => {
    if (activeCode) {
      activeCode.text += value
      return
    }
    for (const part of value.split(/([\t\n\f\r ]+)/)) {
      if (!part) continue
      if (/^[\t\n\f\r ]+$/.test(part)) {
        pendingSpace = true
        continue
      }
      flushSpace()
      prefixQuote()
      append(
        part
          .replace(/([\\`*_[\]<>|])/g, "\\$1")
          .replace(/~/g, "\\~")
          .replace(/^([#+-])/, "\\$1")
          .replace(/^(\d+)\./, "$1\\."),
      )
    }
  }
  const destination = (value: string) => value.replace(/([\\()])/g, "\\$1").replace(/[\t\n\r ]+/g, "%20")
  const title = (value: string | undefined) => (value ? ` "${value.replace(/([\\"])/g, "\\$1")}"` : "")
  const finishCode = (code: NonNullable<Frame["code"]>) => {
    let longest = 0
    let current = 0
    for (const character of code.text) {
      current = character === "`" ? current + 1 : 0
      longest = Math.max(longest, current)
    }
    const fence = "`".repeat(Math.max(code.inline ? 1 : 3, longest + 1))
    if (code.inline) {
      const padding = /^ | $/.test(code.text) && !/^ +$/.test(code.text) ? " " : ""
      flushSpace()
      inline(`${fence}${padding}${code.text}${padding}${fence}`)
      return
    }
    block()
    const value = `${fence}${code.language ?? ""}\n${code.text}${code.text.endsWith("\n") ? "" : "\n"}${fence}`
    const quoted = quoteDepth > 0 ? value.replace(/^/gm, `${"> ".repeat(Math.min(8, quoteDepth))}`) : value
    const placeholder = `\u0000${raw.length}\u0000`
    raw.push(quoted)
    append(placeholder)
    block()
  }

  const parser = new Parser({
    onopentag(name, attributes) {
      const suppressed = (stack.at(-1)?.suppressed ?? false) || omitted.has(name)
      const frame: Frame = { tag: name, suppressed }
      stack.push(frame)
      if (suppressed) return

      if (activeCode && !activeCode.inline) {
        if (name === "code" && attributes.class) activeCode.language = attributes.class.match(/(?:language-|lang-)([^\s]+)/)?.[1]
        return
      }
      if (name === "pre") {
        frame.code = { inline: false, text: "" }
        activeCode = frame.code
        return
      }
      if (name === "code") {
        frame.code = { inline: true, text: "" }
        activeCode = frame.code
        return
      }
      if (/^h[1-6]$/.test(name)) {
        block()
        inline(`${"#".repeat(Number(name[1]))} `)
        return
      }
      if (blocks.has(name)) {
        if (name === "p" && last === " ") return
        block()
        return
      }
      if (name === "br") {
        pendingSpace = false
        inline("  \n")
        needsQuotePrefix = quoteDepth > 0
        return
      }
      if (name === "hr") {
        block()
        inline("---")
        block()
        return
      }
      if (name === "strong" || name === "b") {
        inline("**", true)
        frame.marker = { index: output.length - 1, block: blockCount, value: "**" }
        return
      }
      if (name === "em" || name === "i") {
        inline("*", true)
        frame.marker = { index: output.length - 1, block: blockCount, value: "*" }
        return
      }
      if (name === "s" || name === "strike" || name === "del") {
        inline("~~", true)
        frame.marker = { index: output.length - 1, block: blockCount, value: "~~" }
        return
      }
      if (name === "a") {
        frame.link = { href: attributes.href ?? "", title: attributes.title }
        return inline(`[`, true)
      }
      if (name === "img") {
        inline(`![${(attributes.alt ?? "").replace(/([\\\]])/g, "\\$1")}](${destination(attributes.src ?? "")}${title(attributes.title)})`, true)
        return
      }
      if (name === "blockquote") {
        block()
        quoteDepth++
        needsQuotePrefix = true
        return
      }
      if (name === "ul" || name === "ol") {
        frame.list = { ordered: name === "ol", next: Number.parseInt(attributes.start ?? "1") || 1 }
        listDepth++
        block()
        return
      }
      if (name === "li") {
        block()
        const list = stack.findLast((item) => item.list)?.list
        const marker = list?.ordered ? `${list.next++}.` : "-"
        inline(`${"  ".repeat(Math.min(8, Math.max(0, listDepth - 1)))}${marker} `)
        return
      }
      if (name === "table") {
        tableDepth++
        if (tableDepth === 1) {
          frame.table = { cells: 0, header: false, rows: 0 }
          activeTable = frame.table
          block()
        } else pendingSpace = true
        return
      }
      if (name === "tr") {
        if (tableDepth !== 1) {
          pendingSpace = true
          return
        }
        const table = activeTable
        pendingSpace = false
        if (table && table.rows > 0) {
          append("\n")
          needsQuotePrefix = quoteDepth > 0
        }
        inline("|")
        return
      }
      if (name === "th" || name === "td") {
        if (tableDepth !== 1) {
          pendingSpace = true
          return
        }
        const table = activeTable
        if (table) {
          table.cells++
          table.header ||= name === "th"
        }
        inline(" ")
        frame.cell = { start: output.length }
      }
    },
    ontext(value) {
      if (stack.at(-1)?.suppressed) return
      text(value)
    },
    onclosetag(name) {
      const frame = stack.pop()
      if (!frame || frame.suppressed) return
      if (frame.code) {
        activeCode = undefined
        return finishCode(frame.code)
      }
      if (name === "strong" || name === "b" || name === "em" || name === "i" || name === "s" || name === "strike" || name === "del") {
        const value = name === "strong" || name === "b" ? "**" : name === "em" || name === "i" ? "*" : "~~"
        if (frame.marker && frame.marker.block !== blockCount) {
          output[frame.marker.index] = ""
          return
        }
        if (frame.marker && output.length === frame.marker.index + 1) {
          output[frame.marker.index] = ""
          return
        }
        return inline(value)
      }
      if (name === "a") {
        return inline(`](${destination(frame.link?.href ?? "")}${title(frame.link?.title)})`)
      }
      if (/^h[1-6]$/.test(name) || blocks.has(name)) return block()
      if (name === "blockquote") {
        quoteDepth--
        return block()
      }
      if (name === "li") return block()
      if (name === "ul" || name === "ol") {
        listDepth--
        return block()
      }
      if ((name === "th" || name === "td") && tableDepth === 1) {
        if (frame.cell) {
          const value = output
            .splice(frame.cell.start)
            .join("")
            .replace(/[\t\r\n ]+/g, " ")
            .trim()
            .replace(/(?<!\\)\|/g, "\\|")
          append(value)
        }
        return inline(" |")
      }
      if (name === "tr") {
        if (tableDepth !== 1) return
        const table = activeTable
        if (table && table.rows === 0) {
          inline("\n")
          needsQuotePrefix = quoteDepth > 0
          inline(`|${" --- |".repeat(table.cells)}`)
        }
        if (table) {
          table.rows++
          table.cells = 0
        }
        return
      }
      if (name === "table") {
        tableDepth--
        if (tableDepth === 0) {
          activeTable = undefined
          return block()
        }
        pendingSpace = true
      }
    },
  })
  parser.write(html)
  parser.end()
  return output
    .join("")
    .replace(/[ \t]+\n/g, (value) => (value.startsWith("  ") ? "  \n" : "\n"))
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/\u0000(\d+)\u0000/g, (_, index) => raw[Number(index)] ?? "")
}

function hasPathologicalDepth(html: string) {
  let depth = 0
  for (const match of html.matchAll(/<\s*(\/)?\s*([a-z][\w:-]*)\b[^>]*>/gi)) {
    if (match[1]) depth = Math.max(0, depth - 1)
    else if (!/\/$/.test(match[0].slice(0, -1).trim()) && !["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"].includes(match[2].toLowerCase())) depth++
    if (depth > 10_000) return true
  }
  return false
}

function extractPathologicalText(html: string) {
  let output = ""
  let suppressed = 0
  const parser = new Parser({
    onopentag(name) {
      if (suppressed > 0 || omitted.has(name)) suppressed++
    },
    ontext(value) {
      if (suppressed === 0) output += value
    },
    onclosetag() {
      if (suppressed > 0) suppressed--
    },
  })
  parser.write(html.replace(/<\/?(?:[^>]+)>/g, (tag) => (omitted.has(tag.match(/^<\/?\s*([^\s/>]+)/)?.[1]?.toLowerCase() ?? "") ? tag : " ")))
  parser.end()
  return output.replace(/[\t\n\f\r ]+/g, " ").trim()
}
