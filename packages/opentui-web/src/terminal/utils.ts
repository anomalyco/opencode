import { TerminalBuffer } from "./buffer"
import { Colors } from "./types"

// Wrap text to fit within column width
export function wrapText(text: string, maxCols: number): string[] {
  const lines: string[] = []
  const paragraphs = text.split("\n")

  for (const para of paragraphs) {
    if (para.length === 0) {
      lines.push("")
      continue
    }

    let currentLine = ""
    const words = para.split(" ")

    for (const word of words) {
      // If word itself is longer than maxCols, split it
      if (word.length > maxCols) {
        if (currentLine) {
          lines.push(currentLine)
          currentLine = ""
        }
        // Split long word into chunks
        for (let i = 0; i < word.length; i += maxCols) {
          lines.push(word.slice(i, i + maxCols))
        }
        continue
      }

      // Check if adding this word exceeds the line
      const testLine = currentLine ? `${currentLine} ${word}` : word
      if (testLine.length > maxCols) {
        if (currentLine) {
          lines.push(currentLine)
        }
        currentLine = word
      } else {
        currentLine = testLine
      }
    }

    if (currentLine) {
      lines.push(currentLine)
    }
  }

  return lines
}

// Pad string to exact width with spaces
export function padString(text: string, width: number, align: "left" | "center" | "right" = "left"): string {
  if (text.length >= width) return text.slice(0, width)

  const padding = width - text.length

  switch (align) {
    case "center": {
      const leftPad = Math.floor(padding / 2)
      const rightPad = padding - leftPad
      return " ".repeat(leftPad) + text + " ".repeat(rightPad)
    }
    case "right":
      return " ".repeat(padding) + text
    default:
      return text + " ".repeat(padding)
  }
}

// Truncate string with ellipsis if too long
export function truncateString(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text
  if (maxWidth <= 3) return text.slice(0, maxWidth)
  return text.slice(0, maxWidth - 3) + "..."
}

// Fill a horizontal line
export function drawHorizontalLine(
  buffer: TerminalBuffer,
  row: number,
  startCol: number,
  endCol: number,
  bg: string = Colors.BORDER,
) {
  for (let col = startCol; col <= endCol; col++) {
    buffer.writeChar(col, row, {
      char: " ",
      bg,
    })
  }
}

// Fill a vertical region with background color
export function fillColumn(buffer: TerminalBuffer, col: number, startRow: number, endRow: number, bg: string) {
  for (let row = startRow; row <= endRow; row++) {
    buffer.writeChar(col, row, {
      char: " ",
      bg,
    })
  }
}

// Create a separator line (full of spaces with background color)
export function drawSeparator(
  buffer: TerminalBuffer,
  row: number,
  startCol: number,
  width: number,
  bg: string = Colors.BORDER,
) {
  buffer.fillRect(startCol, row, width, 1, {
    char: " ",
    bg,
  })
}

// Draw context bar with colored segments
// segments: array of {width: number, color: string} representing token breakdown
export function drawContextBar(
  buffer: TerminalBuffer,
  row: number,
  startCol: number,
  totalWidth: number,
  segments: Array<{ width: number; color: string }>,
) {
  let currentCol = startCol

  // Left bracket
  buffer.writeChar(currentCol, row, {
    char: "[",
    fg: Colors.TEXT_MAIN,
    bg: Colors.BG_PANEL,
  })
  currentCol++

  // Draw segments with solid block characters
  for (const segment of segments) {
    for (let i = 0; i < segment.width && currentCol < startCol + totalWidth - 1; i++) {
      buffer.writeChar(currentCol, row, {
        char: " ",
        bg: segment.color,
      })
      currentCol++
    }
  }

  // Fill remaining space
  while (currentCol < startCol + totalWidth - 1) {
    buffer.writeChar(currentCol, row, {
      char: " ",
      fg: Colors.TEXT_MAIN,
      bg: Colors.BG_PANEL,
    })
    currentCol++
  }

  // Right bracket
  buffer.writeChar(startCol + totalWidth - 1, row, {
    char: "]",
    fg: Colors.TEXT_MAIN,
    bg: Colors.BG_PANEL,
  })
}
