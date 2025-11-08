/**
 * Rich Terminal UI - Enhanced output formatting for the best CLI experience
 */

import { EOL } from "os"
import { UI } from "./ui"

export namespace RichUI {
  // Box drawing characters
  const BOX = {
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    horizontal: "─",
    vertical: "│",
    cross: "┼",
    verticalRight: "├",
    verticalLeft: "┤",
    horizontalDown: "┬",
    horizontalUp: "┴",
  }

  const DOUBLE_BOX = {
    topLeft: "╔",
    topRight: "╗",
    bottomLeft: "╚",
    bottomRight: "╝",
    horizontal: "═",
    vertical: "║",
    cross: "╬",
    verticalRight: "╠",
    verticalLeft: "╣",
    horizontalDown: "╦",
    horizontalUp: "╩",
  }

  // Icons and symbols
  export const Icons = {
    success: "✓",
    error: "✗",
    warning: "⚠",
    info: "ℹ",
    rocket: "🚀",
    sparkles: "✨",
    fire: "🔥",
    lightning: "⚡",
    check: "✔",
    cross: "✘",
    star: "★",
    arrow: "→",
    arrowRight: "▶",
    arrowLeft: "◀",
    bullet: "•",
    dot: "·",
    ellipsis: "…",
    loading: "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏",
    progress: "▰▱",
    pointer: "❯",
  }

  /**
   * Create a formatted box around content
   */
  export function box(
    content: string,
    options: {
      title?: string
      padding?: number
      style?: keyof typeof UI.Style
      double?: boolean
    } = {},
  ): string {
    const { title, padding = 1, style = "TEXT_NORMAL", double = false } = options
    const box = double ? DOUBLE_BOX : BOX
    const lines = content.split(EOL)

    const maxWidth = Math.max(...lines.map((line) => stripAnsi(line).length), title?.length || 0)
    const width = maxWidth + padding * 2

    const topLine =
      box.topLeft +
      (title
        ? box.horizontal +
          ` ${title} ` +
          box.horizontal.repeat(Math.max(0, width - title.length - 3))
        : box.horizontal.repeat(width)) +
      box.topRight

    const paddedLines = lines.map(
      (line) =>
        box.vertical +
        " ".repeat(padding) +
        line +
        " ".repeat(width - stripAnsi(line).length - padding) +
        box.vertical,
    )

    const bottomLine = box.bottomLeft + box.horizontal.repeat(width) + box.bottomRight

    const colorCode = UI.Style[style]
    return [colorCode + topLine, ...paddedLines, bottomLine + UI.Style.TEXT_NORMAL].join(EOL)
  }

  /**
   * Create a formatted table
   */
  export function table(
    headers: string[],
    rows: string[][],
    options: { style?: keyof typeof UI.Style; align?: ("left" | "right" | "center")[] } = {},
  ): string {
    const { style = "TEXT_NORMAL", align = [] } = options
    const colorCode = UI.Style[style]

    // Calculate column widths
    const columnWidths = headers.map((header, i) => {
      const headerWidth = stripAnsi(header).length
      const maxRowWidth = Math.max(...rows.map((row) => stripAnsi(row[i] || "").length))
      return Math.max(headerWidth, maxRowWidth)
    })

    const formatCell = (text: string, width: number, alignment: "left" | "right" | "center" = "left") => {
      const stripped = stripAnsi(text)
      const padding = width - stripped.length
      if (alignment === "right") {
        return " ".repeat(padding) + text
      } else if (alignment === "center") {
        const leftPad = Math.floor(padding / 2)
        const rightPad = padding - leftPad
        return " ".repeat(leftPad) + text + " ".repeat(rightPad)
      }
      return text + " ".repeat(padding)
    }

    // Create header
    const headerLine = BOX.vertical + " " + headers.map((h, i) => formatCell(h, columnWidths[i], "center")).join(" " + BOX.vertical + " ") + " " + BOX.vertical

    const topLine =
      BOX.topLeft +
      columnWidths.map((w) => BOX.horizontal.repeat(w + 2)).join(BOX.horizontalDown) +
      BOX.topRight

    const separatorLine =
      BOX.verticalRight +
      columnWidths.map((w) => BOX.horizontal.repeat(w + 2)).join(BOX.cross) +
      BOX.verticalLeft

    const bottomLine =
      BOX.bottomLeft +
      columnWidths.map((w) => BOX.horizontal.repeat(w + 2)).join(BOX.horizontalUp) +
      BOX.bottomRight

    const rowLines = rows.map(
      (row) =>
        BOX.vertical +
        " " +
        row.map((cell, i) => formatCell(cell || "", columnWidths[i], align[i] || "left")).join(" " + BOX.vertical + " ") +
        " " +
        BOX.vertical,
    )

    return [colorCode + topLine, headerLine, separatorLine, ...rowLines, bottomLine + UI.Style.TEXT_NORMAL].join(EOL)
  }

  /**
   * Create a progress bar
   */
  export function progressBar(
    current: number,
    total: number,
    options: { width?: number; showPercentage?: boolean; style?: keyof typeof UI.Style } = {},
  ): string {
    const { width = 40, showPercentage = true, style = "TEXT_SUCCESS" } = options
    const percentage = Math.min(100, Math.max(0, (current / total) * 100))
    const filled = Math.floor((percentage / 100) * width)
    const empty = width - filled

    const bar = "█".repeat(filled) + "░".repeat(empty)
    const percentText = showPercentage ? ` ${percentage.toFixed(1)}%` : ""

    return UI.Style[style] + bar + UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + percentText + UI.Style.TEXT_NORMAL
  }

  /**
   * Create a spinner animation frame
   */
  export function spinner(frame: number = 0): string {
    const frames = Icons.loading.split("")
    return frames[frame % frames.length]
  }

  /**
   * Format a list with bullets or numbers
   */
  export function list(
    items: string[],
    options: { ordered?: boolean; style?: keyof typeof UI.Style; indent?: number } = {},
  ): string {
    const { ordered = false, style = "TEXT_NORMAL", indent = 0 } = options
    const colorCode = UI.Style[style]
    const indentStr = " ".repeat(indent)

    return items
      .map((item, i) => {
        const marker = ordered ? `${i + 1}.` : Icons.bullet
        return `${indentStr}${colorCode}${marker}${UI.Style.TEXT_NORMAL} ${item}`
      })
      .join(EOL)
  }

  /**
   * Create a banner with ASCII art border
   */
  export function banner(text: string, style: keyof typeof UI.Style = "TEXT_HIGHLIGHT_BOLD"): string {
    const width = Math.max(...text.split(EOL).map((line) => stripAnsi(line).length)) + 4
    const border = DOUBLE_BOX.horizontal.repeat(width)

    const lines = text.split(EOL).map((line) => {
      const padding = width - stripAnsi(line).length - 4
      const leftPad = Math.floor(padding / 2)
      const rightPad = padding - leftPad
      return `${DOUBLE_BOX.vertical} ${" ".repeat(leftPad)}${line}${" ".repeat(rightPad)} ${DOUBLE_BOX.vertical}`
    })

    return [
      UI.Style[style] + DOUBLE_BOX.topLeft + border + DOUBLE_BOX.topRight,
      ...lines,
      DOUBLE_BOX.bottomLeft + border + DOUBLE_BOX.bottomRight + UI.Style.TEXT_NORMAL,
    ].join(EOL)
  }

  /**
   * Format a key-value pair display
   */
  export function keyValue(
    data: Record<string, string>,
    options: { keyStyle?: keyof typeof UI.Style; valueStyle?: keyof typeof UI.Style; separator?: string } = {},
  ): string {
    const { keyStyle = "TEXT_DIM", valueStyle = "TEXT_NORMAL", separator = ": " } = options

    const maxKeyLength = Math.max(...Object.keys(data).map((key) => key.length))

    return Object.entries(data)
      .map(([key, value]) => {
        const paddedKey = key.padEnd(maxKeyLength)
        return `${UI.Style[keyStyle]}${paddedKey}${UI.Style.TEXT_NORMAL}${separator}${UI.Style[valueStyle]}${value}${UI.Style.TEXT_NORMAL}`
      })
      .join(EOL)
  }

  /**
   * Create a status indicator
   */
  export function status(
    type: "success" | "error" | "warning" | "info" | "loading",
    message: string,
  ): string {
    const config = {
      success: { icon: Icons.success, style: "TEXT_SUCCESS_BOLD" as const },
      error: { icon: Icons.error, style: "TEXT_DANGER_BOLD" as const },
      warning: { icon: Icons.warning, style: "TEXT_WARNING_BOLD" as const },
      info: { icon: Icons.info, style: "TEXT_INFO_BOLD" as const },
      loading: { icon: spinner(0), style: "TEXT_HIGHLIGHT_BOLD" as const },
    }

    const { icon, style } = config[type]
    return `${UI.Style[style]}${icon}${UI.Style.TEXT_NORMAL} ${message}`
  }

  /**
   * Create a tree structure
   */
  export function tree(
    items: Array<{ label: string; children?: Array<{ label: string }> }>,
    options: { style?: keyof typeof UI.Style } = {},
  ): string {
    const { style = "TEXT_NORMAL" } = options
    const lines: string[] = []

    items.forEach((item, index) => {
      const isLast = index === items.length - 1
      const prefix = isLast ? "└─ " : "├─ "
      lines.push(`${UI.Style[style]}${prefix}${UI.Style.TEXT_NORMAL}${item.label}`)

      if (item.children) {
        item.children.forEach((child, childIndex) => {
          const childIsLast = childIndex === item.children!.length - 1
          const childPrefix = isLast ? "   " : "│  "
          const childMarker = childIsLast ? "└─ " : "├─ "
          lines.push(`${UI.Style[style]}${childPrefix}${childMarker}${UI.Style.TEXT_NORMAL}${child.label}`)
        })
      }
    })

    return lines.join(EOL)
  }

  /**
   * Create a fancy divider
   */
  export function divider(
    length: number = 80,
    char: string = "─",
    style: keyof typeof UI.Style = "TEXT_DIM",
  ): string {
    return UI.Style[style] + char.repeat(length) + UI.Style.TEXT_NORMAL
  }

  /**
   * Create a formatted panel with header and content
   */
  export function panel(
    header: string,
    content: string,
    options: { style?: keyof typeof UI.Style; width?: number } = {},
  ): string {
    const { style = "TEXT_HIGHLIGHT", width = 80 } = options

    const headerLine =
      BOX.topLeft + BOX.horizontal + ` ${header} ` + BOX.horizontal.repeat(Math.max(0, width - header.length - 4)) + BOX.topRight

    const contentLines = content.split(EOL).map((line) => {
      const padding = width - 2 - stripAnsi(line).length
      return BOX.vertical + " " + line + " ".repeat(Math.max(0, padding)) + BOX.vertical
    })

    const footerLine = BOX.bottomLeft + BOX.horizontal.repeat(width) + BOX.bottomRight

    return [UI.Style[style] + headerLine, ...contentLines, footerLine + UI.Style.TEXT_NORMAL].join(EOL)
  }

  /**
   * Strip ANSI escape codes from string for length calculation
   */
  function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, "")
  }

  /**
   * Format bytes to human readable format
   */
  export function formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"]
    let size = bytes
    let unitIndex = 0

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`
  }

  /**
   * Format duration to human readable format
   */
  export function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`
  }

  /**
   * Create a comparison display
   */
  export function diff(before: string, after: string, label: string = "Changes"): string {
    return [
      UI.Style.TEXT_HIGHLIGHT_BOLD + label + UI.Style.TEXT_NORMAL,
      UI.Style.TEXT_DANGER + "- " + before + UI.Style.TEXT_NORMAL,
      UI.Style.TEXT_SUCCESS + "+ " + after + UI.Style.TEXT_NORMAL,
    ].join(EOL)
  }

  /**
   * Create a badge
   */
  export function badge(text: string, style: keyof typeof UI.Style = "TEXT_INFO_BOLD"): string {
    return `${UI.Style[style]}[${text}]${UI.Style.TEXT_NORMAL}`
  }
}
