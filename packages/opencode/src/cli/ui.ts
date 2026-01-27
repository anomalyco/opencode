import z from "zod"
import { EOL } from "os"
import { NamedError } from "@opencode-ai/util/error"

export namespace UI {
  // Logo with shadow markers matching brand guidelines (PR #8584)
  // _ = space with shadow background
  // ^ = ▀ with foreground + shadow background
  // ~ = ▀ in shadow color only
  const LOGO_LEFT = [`                   `, `█▀▀█ █▀▀█ █▀▀█ █▀▀▄`, `█__█ █__█ █^^^ █__█`, `▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀`]
  const LOGO_RIGHT = [`             ▄     `, `█▀▀▀ █▀▀█ █▀▀█ █▀▀█`, `█___ █__█ █__█ █^^^`, `▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`]

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
    Bun.stderr.write(EOL)
  }

  export function print(...message: string[]) {
    blank = false
    Bun.stderr.write(message.join(" "))
  }

  let blank = false
  export function empty() {
    if (blank) return
    println("" + Style.TEXT_NORMAL)
    blank = true
  }

  // Render a logo line, replacing shadow markers with ANSI escape codes
  // _ = space with dim background
  // ^ = ▀ with foreground + dim background
  // ~ = ▀ in dim/shadow color
  function renderLine(line: string, color: string): string {
    const reset = "\x1b[0m"
    const dimBg = "\x1b[48;5;236m" // dark gray background for shadow
    const dimFg = "\x1b[38;5;236m" // dark gray foreground for shadow
    let result = ""
    for (const char of line) {
      if (char === "_") {
        result += dimBg + " " + reset + color
      } else if (char === "^") {
        result += dimBg + "▀" + reset + color
      } else if (char === "~") {
        result += dimFg + "▀" + reset + color
      } else {
        result += char
      }
    }
    return result
  }

  export function logo(pad?: string) {
    const result = []
    const gray = Bun.color("gray", "ansi") ?? ""
    const reset = "\x1b[0m"
    for (let i = 0; i < LOGO_LEFT.length; i++) {
      if (pad) result.push(pad)
      result.push(gray)
      result.push(renderLine(LOGO_LEFT[i], gray))
      result.push(reset)
      result.push(" ") // space between "open" and "code"
      result.push(renderLine(LOGO_RIGHT[i], reset))
      result.push(EOL)
    }
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
    println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
  }

  export function markdown(text: string): string {
    return text
  }
}
