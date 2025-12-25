export namespace TextFormat {
  // Width cache for performance optimization
  const widthCache = new Map<string, number>()
  let cacheOperationCount = 0

  /**
   * Formats markdown tables in the given text
   */
  export function formatMarkdownTables(text: string): string {
    const lines = text.split("\n")
    const result: string[] = []
    let i = 0

    while (i < lines.length) {
      const line = lines[i]

      if (isTableRow(line)) {
        const tableLines: string[] = [line]
        i++

        while (i < lines.length && isTableRow(lines[i])) {
          tableLines.push(lines[i])
          i++
        }

        if (isValidTable(tableLines)) {
          result.push(...formatTable(tableLines))
        } else {
          result.push(...tableLines)
          result.push("<!-- table not formatted: invalid structure -->")
        }
      } else {
        result.push(line)
        i++
      }
    }

    incrementOperationCount()
    return result.join("\n")
  }

  function isTableRow(line: string): boolean {
    const trimmed = line.trim()
    return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.split("|").length > 2
  }

  function isSeparatorRow(line: string): boolean {
    const trimmed = line.trim()
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false
    const cells = trimmed.split("|").slice(1, -1)
    return cells.length > 0 && cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell))
  }

  function isValidTable(lines: string[]): boolean {
    if (lines.length < 2) return false

    const rows = lines.map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )

    if (rows.length === 0 || rows[0].length === 0) return false

    const firstRowCellCount = rows[0].length
    const allSameColumnCount = rows.every((row) => row.length === firstRowCellCount)
    if (!allSameColumnCount) return false

    const hasSeparator = lines.some((line) => isSeparatorRow(line))
    return hasSeparator
  }

  function formatTable(lines: string[]): string[] {
    const separatorIndices = new Set<number>()
    for (let i = 0; i < lines.length; i++) {
      if (isSeparatorRow(lines[i])) separatorIndices.add(i)
    }

    const rows = lines.map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )

    if (rows.length === 0) return lines

    const colCount = Math.max(...rows.map((row) => row.length))

    const colAlignments: Array<"left" | "center" | "right"> = Array(colCount).fill("left")
    for (const rowIndex of separatorIndices) {
      const row = rows[rowIndex]
      for (let col = 0; col < row.length; col++) {
        colAlignments[col] = getAlignment(row[col])
      }
    }

    const colWidths: number[] = Array(colCount).fill(3)
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      if (separatorIndices.has(rowIndex)) continue
      const row = rows[rowIndex]
      for (let col = 0; col < row.length; col++) {
        const displayWidth = calculateDisplayWidth(row[col])
        colWidths[col] = Math.max(colWidths[col], displayWidth)
      }
    }

    return rows.map((row, rowIndex) => {
      const cells: string[] = []
      for (let col = 0; col < colCount; col++) {
        const cell = row[col] ?? ""
        const align = colAlignments[col]

        if (separatorIndices.has(rowIndex)) {
          cells.push(formatSeparatorCell(colWidths[col], align))
        } else {
          cells.push(padCell(cell, colWidths[col], align))
        }
      }
      return "| " + cells.join(" | ") + " |"
    })
  }

  function getAlignment(delimiterCell: string): "left" | "center" | "right" {
    const trimmed = delimiterCell.trim()
    const hasLeftColon = trimmed.startsWith(":")
    const hasRightColon = trimmed.endsWith(":")

    if (hasLeftColon && hasRightColon) return "center"
    if (hasRightColon) return "right"
    return "left"
  }

  function calculateDisplayWidth(text: string): number {
    if (widthCache.has(text)) {
      return widthCache.get(text)!
    }

    const width = getStringWidth(text)
    widthCache.set(text, width)
    return width
  }

  function getStringWidth(text: string): number {
    // Strip markdown symbols for concealment mode
    // Users with concealment ON don't see **, *, ~~, ` but DO see markdown inside `code`

    // CRITICAL: Content inside backticks should PRESERVE inner markdown symbols
    // because concealment treats them as literal text, not markdown

    // Step 1: Extract and protect inline code content
    const codeBlocks: string[] = []
    let textWithPlaceholders = text.replace(/`(.+?)`/g, (_match, content) => {
      codeBlocks.push(content)
      return `\x00CODE${codeBlocks.length - 1}\x00`
    })

    // Step 2: Strip markdown from non-code parts
    let visualText = textWithPlaceholders
    let previousText = ""

    while (visualText !== previousText) {
      previousText = visualText
      visualText = visualText
        .replace(/\*\*\*(.+?)\*\*\*/g, "$1") // ***bold+italic*** -> text
        .replace(/\*\*(.+?)\*\*/g, "$1") // **bold** -> bold
        .replace(/\*(.+?)\*/g, "$1") // *italic* -> italic
        .replace(/~~(.+?)~~/g, "$1") // ~~strike~~ -> strike
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1") // ![alt](url) -> alt (OpenTUI shows only alt text)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)") // [text](url) -> text (url)
    }

    // Step 3: Restore code content (with its original markdown preserved)
    visualText = visualText.replace(/\x00CODE(\d+)\x00/g, (_match, index) => {
      return codeBlocks[parseInt(index)]
    })

    // Use Bun's stringWidth if available, otherwise fallback to simple length
    if (typeof Bun !== "undefined" && Bun.stringWidth) {
      return Bun.stringWidth(visualText)
    }
    return visualText.length
  }

  function padCell(text: string, width: number, align: "left" | "center" | "right"): string {
    const displayWidth = calculateDisplayWidth(text)
    const totalPadding = Math.max(0, width - displayWidth)

    if (align === "center") {
      const leftPad = Math.floor(totalPadding / 2)
      const rightPad = totalPadding - leftPad
      return " ".repeat(leftPad) + text + " ".repeat(rightPad)
    } else if (align === "right") {
      return " ".repeat(totalPadding) + text
    } else {
      return text + " ".repeat(totalPadding)
    }
  }

  function formatSeparatorCell(width: number, align: "left" | "center" | "right"): string {
    if (align === "center") return ":" + "-".repeat(Math.max(1, width - 2)) + ":"
    if (align === "right") return "-".repeat(Math.max(1, width - 1)) + ":"
    return "-".repeat(width)
  }

  function incrementOperationCount() {
    cacheOperationCount++

    if (cacheOperationCount > 100 || widthCache.size > 1000) {
      cleanupCache()
    }
  }

  function cleanupCache() {
    widthCache.clear()
    cacheOperationCount = 0
  }
}
