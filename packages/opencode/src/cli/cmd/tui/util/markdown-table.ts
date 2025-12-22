import { marked } from "marked"

interface TableToken {
  type: "table"
  header: Array<{ text: string }>
  rows: Array<Array<{ text: string }>>
  raw: string
}

export function formatMarkdownTables(markdown: string): string {
  // Quick heuristic: tables must have pipes and a separator row like |---|
  // Skip expensive parsing if no table-like patterns exist
  if (!markdown.includes("|") || !/\|[\s-:]+\|/.test(markdown)) {
    return markdown
  }

  const tokens = marked.lexer(markdown)

  // Collect all table tokens with their positions
  const tables: Array<{ token: TableToken; start: number; end: number }> = []
  let searchStart = 0

  for (const token of tokens) {
    if (token.type === "table" && "header" in token && "rows" in token) {
      const start = markdown.indexOf(token.raw, searchStart)
      if (start !== -1) {
        tables.push({
          token: token as TableToken,
          start,
          end: start + token.raw.length,
        })
        searchStart = start + token.raw.length
      }
    }
  }

  // Process tables in reverse order so replacements don't affect earlier positions
  let result = markdown
  for (let i = tables.length - 1; i >= 0; i--) {
    const { token, start, end } = tables[i]
    const formattedTable = renderTerminalTable(token)
    result = result.substring(0, start) + formattedTable + result.substring(end)
  }

  return result
}

function renderTerminalTable(token: TableToken): string {
  const headers = token.header.map((cell) => stripMarkdown(cell.text))
  const rows = token.rows.map((row) => row.map((cell) => stripMarkdown(cell.text)))

  const colWidths: number[] = headers.map((h) => h.length)
  rows.forEach((row) => {
    row.forEach((cell, i) => {
      colWidths[i] = Math.max(colWidths[i] || 0, cell.length)
    })
  })

  const lines: string[] = []

  lines.push("┌" + colWidths.map((w) => "─".repeat(w + 2)).join("┬") + "┐")

  lines.push(
    "│ " +
      headers.map((h, i) => h.padEnd(colWidths[i])).join(" │ ") +
      " │",
  )

  lines.push("├" + colWidths.map((w) => "─".repeat(w + 2)).join("┼") + "┤")

  rows.forEach((row) => {
    lines.push(
      "│ " +
        row.map((cell, i) => cell.padEnd(colWidths[i])).join(" │ ") +
        " │",
    )
  })

  lines.push("└" + colWidths.map((w) => "─".repeat(w + 2)).join("┴") + "┘")

  return "\n" + lines.join("\n") + "\n"
}

function stripMarkdown(text: string): string {
  return (
    text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/~~([^~]+)~~/g, "$1")
      .trim()
  )
}
