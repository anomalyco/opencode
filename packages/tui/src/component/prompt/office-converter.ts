/**
 * Converts Microsoft Office files to Markdown for LLM consumption.
 *
 * .docx → mammoth.convertToHtml() → htmlToMarkdown()
 *         (mammoth docs state convertToMarkdown is deprecated; the HTML pipeline
 *          is the recommended approach and produces better results.)
 * .xlsx → xlsx/SheetJS sheet_to_json({ header: 1 }) → GFM Markdown tables
 */

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

/**
 * Convert an Office file buffer to a Markdown string.
 * Returns undefined if the MIME type is not supported or conversion yields no content.
 */
export async function convertOfficeFile(bytes: Uint8Array, mime: string): Promise<string | undefined> {
  if (mime === DOCX_MIME) return convertDocx(bytes)
  if (mime === XLSX_MIME) return convertXlsx(bytes)
  return undefined
}

// ─── .docx ───────────────────────────────────────────────────────────────────

async function convertDocx(bytes: Uint8Array): Promise<string | undefined> {
  try {
    // mammoth.convertToHtml is the primary typed API.
    // Per mammoth README: "Markdown support is deprecated. Generating HTML and
    // using a separate library to convert the HTML to Markdown is recommended."
    const mammoth = await import("mammoth")
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })
    const md = htmlToMarkdown(result.value).trim()
    return md.length > 0 ? md : undefined
  } catch {
    return undefined
  }
}

/** Convert the clean, predictable HTML mammoth produces into Markdown. */
function htmlToMarkdown(html: string): string {
  // Process structures that require row/item accumulation before flat replacements.
  let out = processLists(processTables(html))

  out = out
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `# ${inlineMd(c)}\n\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `## ${inlineMd(c)}\n\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `### ${inlineMd(c)}\n\n`)
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `#### ${inlineMd(c)}\n\n`)
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, c) => `##### ${inlineMd(c)}\n\n`)
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, c) => `###### ${inlineMd(c)}\n\n`)
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, c) => `\`\`\`\n${stripTags(c)}\n\`\`\`\n\n`)
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) =>
      inlineMd(c)
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n") + "\n\n",
    )
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => `${inlineMd(c)}\n\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n---\n\n")

  // Strip any remaining tags, decode entities, normalise whitespace.
  return decodeEntities(stripTags(out)).replace(/\n{3,}/g, "\n\n").trim()
}

/** Replace unordered/ordered list elements with Markdown equivalents. */
function processLists(html: string): string {
  const withOl = html.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
    let i = 0
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, item: string) => `${++i}. ${inlineMd(item).trim()}\n`) + "\n"
  })
  return withOl.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) =>
    content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, item: string) => `- ${inlineMd(item).trim()}\n`) + "\n",
  )
}

/** Replace HTML table elements with a GFM Markdown table. */
function processTables(html: string): string {
  return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableBody) => {
    const rows: string[][] = []
    for (const rowMatch of tableBody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells: string[] = []
      for (const cellMatch of rowMatch[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)) {
        // Flatten cell content: escape pipes, collapse newlines.
        cells.push(inlineMd(cellMatch[1]).replace(/\|/g, "\\|").replace(/\n+/g, " ").trim())
      }
      if (cells.length > 0) rows.push(cells)
    }
    if (rows.length === 0) return ""

    const colCount = Math.max(...rows.map((r) => r.length))
    const padded = rows.map((r) => {
      while (r.length < colCount) r.push("")
      return r
    })

    const [header, ...body] = padded
    if (!header) return ""
    const sep = header.map(() => "---")
    return (
      [`| ${header.join(" | ")} |`, `| ${sep.join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n") +
      "\n\n"
    )
  })
}

/**
 * Convert inline HTML markup (bold, italic, code, links, etc.) into Markdown.
 * Strips all remaining tags afterwards.
 */
function inlineMd(html: string): string {
  return decodeEntities(
    html
      .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
      .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**")
      .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*")
      .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*")
      .replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, "~~$1~~")
      .replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, "~~$1~~")
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
      .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      // Collapse adjacent identical markers that nest (e.g. **foo****bar** → **foobar**)
      .replace(/\*\*([^*]*)\*\*\*\*([^*]*)\*\*/g, "**$1$2**"),
  )
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "")
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

// ─── .xlsx ───────────────────────────────────────────────────────────────────

async function convertXlsx(bytes: Uint8Array): Promise<string | undefined> {
  try {
    // xlsx ships with named ESM exports; import() resolves correctly in Bun.
    const XLSX = await import("xlsx")

    // ParsingOptions.type "array" accepts Uint8Array / any typed-array buffer.
    const workbook = XLSX.read(bytes, { type: "array" })

    const sections: string[] = []
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) continue

      // header: 1  → each row returned as an array of cell values (unknown[][])
      // defval: "" → missing cells filled with "" rather than undefined
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" })
      const table = rowsToMarkdownTable(rows)
      if (table) sections.push(`## Sheet: ${sheetName}\n\n${table}`)
    }

    if (sections.length === 0) return undefined
    return sections.join("\n\n")
  } catch {
    return undefined
  }
}

/** Render a sheet_to_json({ header: 1 }) result as a GFM Markdown table. */
function rowsToMarkdownTable(rows: unknown[][]): string | undefined {
  // Discard completely empty rows before sizing.
  const nonEmpty = rows.filter((r) => r.some((c) => c !== ""))
  if (nonEmpty.length === 0) return undefined

  const colCount = Math.max(...nonEmpty.map((r) => r.length))

  // Pad short rows, stringify and escape pipe characters in every cell.
  const normalised = nonEmpty.map((row) => {
    const padded = [...row]
    while (padded.length < colCount) padded.push("")
    return padded.map((cell) => String(cell ?? "").replace(/\|/g, "\\|").replace(/\n/g, " "))
  })

  const [header, ...body] = normalised
  if (!header) return undefined
  const sep = header.map(() => "---")

  return [`| ${header.join(" | ")} |`, `| ${sep.join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`)].join(
    "\n",
  )
}
