import z from "zod"
import { EOL } from "os"
import { NamedError } from "@f5xc-salesdemos/util/error"
import { logo as glyphs } from "./logo"

const F5_LOGO_LINES = [
  "                   ________",
  "              (▒▒▒▒▓▓▓▓▓▓▓▓▒▒▒▒)",
  "         (▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒)",
  "      (▒▒▓▓▓▓██████████▓▓▓▓█████████████)",
  "    (▒▓▓▓▓██████▒▒▒▒▒███▓▓██████████████▒)",
  "   (▒▓▓▓▓██████▒▓▓▓▓▓▒▒▒▓██▒▒▒▒▒▒▒▒▒▒▒▒▒▓▒)",
  "  (▒▓▓▓▓▓██████▓▓▓▓▓▓▓▓▓██▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒)",
  " (▒▓▓███████████████▓▓▓▓█████████████▓▓▓▓▓▓▒)",
  "(▒▓▓▓▒▒▒███████▒▒▒▒▒▓▓▓████████████████▓▓▓▓▓▒)",
  "|▒▓▓▓▓▓▓▒██████▓▓▓▓▓▓▓████████████████████▓▓▒|",
  "|▒▓▓▓▓▓▓▓██████▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒██████████▓▒|",
  "(▒▓▓▓▓▓▓▓██████▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒████████▒▒)",
  " (▒▓▓▓▓▓▓██████▓▓▓▓▓▓▓███▓▓▓▓▓▓▓▓▓▓▒▒▒████▒▒)",
  "  (▒▓▓▓▓▓██████▓▓▓▓▓▓█████▓▓▓▓▓▓▓▓▓▓▓▓███▒▒)",
  "   (▒▒██████████▓▓▓▓▓▒██████▓▓▓▓▓▓▓▓███▒▒▒)",
  "    (▒▒▒▒▒██████████▓▓▒▒█████████████▒▒▓▒)",
  "      (▒▓▓▒▒▒▒▒▒▒▒▒▒▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒▓▒)",
  "         (▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒)",
  "              (▒▒▒▒▓▓▓▓▓▓▓▓▒▒▒▒)",
]

// Match xcsh branding colors exactly
const ANSI_RED = "\x1b[38;2;202;38;10m"
const ANSI_BOLD_WHITE = "\x1b[1;97m"
const ANSI_RESET = "\x1b[0m"

function renderF5Line(line: string): string {
  let result = ""
  let currentColor: "red" | "white" | "none" = "none"

  for (const char of line) {
    let newColor: "red" | "white" | "none"

    switch (char) {
      case "\u2593": // ▓ - red circle background
      case "\u2592": // ▒ - red outline elements
      case "(":
      case ")":
      case "|":
      case "_":
        newColor = "red"
        break
      case "\u2588": // █ - white F5 text
        newColor = "white"
        break
      default:
        newColor = "none"
    }

    if (newColor !== currentColor) {
      if (currentColor !== "none") {
        result += ANSI_RESET
      }
      if (newColor === "red") {
        result += ANSI_RED
      } else if (newColor === "white") {
        result += ANSI_BOLD_WHITE
      }
      currentColor = newColor
    }

    // Render dark shade as solid block for consistency
    result += char === "\u2593" ? "\u2588" : char
  }

  if (currentColor !== "none") {
    result += ANSI_RESET
  }

  return result
}

export namespace UI {
  const wordmark = [
    `⠀                                ▄     `,
    `█▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀▀ █▀▀█ █▀▀█ █▀▀█`,
    `█  █ █  █ █▀▀▀ █  █ █    █  █ █  █ █▀▀▀`,
    `▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`,
  ]

  export const CancelledError = NamedError.create("UICancelledError", z.void())

  export const Style = {
    TEXT_HIGHLIGHT: "\x1b[96m",
    TEXT_HIGHLIGHT_BOLD: "\x1b[96m\x1b[1m",
    TEXT_DIM: "\x1b[90m",
    TEXT_DIM_BOLD: "\x1b[90m\x1b[1m",
    TEXT_NORMAL: "\x1b[0m",
    TEXT_NORMAL_BOLD: "\x1b[1m",
    TEXT_WARNING: "\x1b[93m",
    TEXT_WARNING_BOLD: "\x1b[93m\x1b[1m",
    TEXT_DANGER: "\x1b[91m",
    TEXT_DANGER_BOLD: "\x1b[91m\x1b[1m",
    TEXT_SUCCESS: "\x1b[92m",
    TEXT_SUCCESS_BOLD: "\x1b[92m\x1b[1m",
    TEXT_INFO: "\x1b[94m",
    TEXT_INFO_BOLD: "\x1b[94m\x1b[1m",
  }

  export function println(...message: string[]) {
    print(...message)
    process.stderr.write(EOL)
  }

  export function print(...message: string[]) {
    blank = false
    process.stderr.write(message.join(" "))
  }

  let blank = false
  export function empty() {
    if (blank) return
    println("" + Style.TEXT_NORMAL)
    blank = true
  }

  export function f5logo(pad?: string) {
    return F5_LOGO_LINES.map((line) => (pad ?? "") + renderF5Line(line)).join(EOL)
  }

  export function f5exitBox(opts: { version: string; sessionTitle: string; sessionId: string; directory?: string }) {
    const red = (s: string) => ANSI_RED + s + ANSI_RESET
    const white = (s: string) => ANSI_BOLD_WHITE + s + ANSI_RESET

    const BOX_TL = "\u256D"
    const BOX_TR = "\u256E"
    const BOX_BL = "\u2570"
    const BOX_BR = "\u256F"
    const BOX_H = "\u2500"
    const BOX_V = "\u2502"

    const logoWidth = Math.max(...F5_LOGO_LINES.map((l) => [...l].length))

    // Visible length of info lines (without ANSI codes)
    const infoVisible = [
      `Session   ${opts.sessionTitle}`,
      ...(opts.directory ? [`Directory ${opts.directory}`] : []),
      `Continue  xcsh -s ${opts.sessionId}`,
    ]
    const maxInfoWidth = Math.max(...infoVisible.map((l) => l.length))

    // Dynamic width: fit logo + 1 space + info content + 2 padding, minimum 80
    const TOTAL_WIDTH = Math.max(80, logoWidth + 1 + maxInfoWidth + 2 + 2)
    const INNER_WIDTH = TOTAL_WIDTH - 2

    const helpColumnWidth = INNER_WIDTH - logoWidth - 1
    const HELP_START_ROW = 8

    const title = ` xcsh ${opts.version} `
    const leftDashes = 3
    const rightDashes = Math.max(0, TOTAL_WIDTH - 1 - leftDashes - title.length - 1)

    // Build info lines for right column
    const dim = Style.TEXT_DIM
    const bold = Style.TEXT_NORMAL_BOLD
    const normal = Style.TEXT_NORMAL
    const infoLines = [
      `${dim}Session   ${normal}${bold}${opts.sessionTitle}${normal}`,
      ...(opts.directory ? [`${dim}Directory ${normal}${bold}${opts.directory}${normal}`] : []),
      `${dim}Continue  ${normal}${bold}xcsh -s ${opts.sessionId}${normal}`,
    ]

    const output: string[] = []

    // Top border with title
    output.push(red(BOX_TL + BOX_H.repeat(leftDashes)) + white(title) + red(BOX_H.repeat(rightDashes) + BOX_TR))

    // Logo lines with info overlay
    for (let i = 0; i < F5_LOGO_LINES.length; i++) {
      const logoLine = F5_LOGO_LINES[i] ?? ""
      const paddedLogo = logoLine.padEnd(logoWidth)
      const coloredLogo = renderF5Line(paddedLogo)

      const helpIndex = i - HELP_START_ROW
      let paddedHelp: string
      if (helpIndex >= 0 && helpIndex < infoLines.length) {
        const visLen = infoVisible[helpIndex]?.length ?? 0
        const padding = Math.max(0, helpColumnWidth - visLen)
        paddedHelp = (infoLines[helpIndex] ?? "") + " ".repeat(padding)
      } else {
        paddedHelp = " ".repeat(helpColumnWidth)
      }

      output.push(red(BOX_V) + coloredLogo + " " + paddedHelp + red(BOX_V))
    }

    // Bottom border
    output.push(red(BOX_BL + BOX_H.repeat(INNER_WIDTH) + BOX_BR))

    return EOL + output.join(EOL) + EOL
  }

  export function logo(pad?: string) {
    if (!process.stdout.isTTY && !process.stderr.isTTY) {
      const result = []
      for (const row of wordmark) {
        if (pad) result.push(pad)
        result.push(row)
        result.push(EOL)
      }
      return result.join("").trimEnd()
    }

    const result: string[] = []
    const reset = "\x1b[0m"
    const left = {
      fg: "\x1b[90m",
      shadow: "\x1b[38;5;235m",
      bg: "\x1b[48;5;235m",
    }
    const right = {
      fg: reset,
      shadow: "\x1b[38;5;238m",
      bg: "\x1b[48;5;238m",
    }
    const gap = " "
    const draw = (line: string, fg: string, shadow: string, bg: string) => {
      const parts: string[] = []
      for (const char of line) {
        if (char === "_") {
          parts.push(bg, " ", reset)
          continue
        }
        if (char === "^") {
          parts.push(fg, bg, "▀", reset)
          continue
        }
        if (char === "~") {
          parts.push(shadow, "▀", reset)
          continue
        }
        if (char === " ") {
          parts.push(" ")
          continue
        }
        parts.push(fg, char, reset)
      }
      return parts.join("")
    }
    glyphs.left.forEach((row, index) => {
      if (pad) result.push(pad)
      result.push(draw(row, left.fg, left.shadow, left.bg))
      result.push(gap)
      const other = glyphs.right[index] ?? ""
      result.push(draw(other, right.fg, right.shadow, right.bg))
      result.push(EOL)
    })
    return result.join("").trimEnd()
  }

  export async function input(prompt: string): Promise<string> {
    const readline = require("readline")
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return new Promise((resolve) => {
      rl.question(prompt, (answer: string) => {
        rl.close()
        resolve(answer.trim())
      })
    })
  }

  export function error(message: string) {
    if (message.startsWith("Error: ")) {
      message = message.slice("Error: ".length)
    }
    println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
  }

  export function markdown(text: string): string {
    return text
  }
}
