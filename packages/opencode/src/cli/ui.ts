import { EOL } from "os"
import { Schema } from "effect"
import { logo as glyphs } from "./logo"
import { Style, LogoColor } from "./ansi"
export { Style }

const wordmark = [
  `⠀                                ▄     `,
  `█▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀▀ █▀▀█ █▀▀█ █▀▀█`,
  `█  █ █  █ █▀▀▀ █  █ █    █  █ █  █ █▀▀▀`,
  `▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`,
]

export class CancelledError extends Schema.TaggedErrorClass<CancelledError>()("UICancelledError", {}) {}

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
  println(Style.TEXT_NORMAL)
  blank = true
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
  const gap = " "
  const { RESET } = LogoColor
  const draw = (line: string, fg: string, shadow: string, bg: string) => {
    const parts: string[] = []
    for (const char of line) {
      if (char === "_") {
        parts.push(bg, " ", RESET)
        continue
      }
      if (char === "^") {
        parts.push(fg, bg, "▀", RESET)
        continue
      }
      if (char === "~") {
        parts.push(shadow, "▀", RESET)
        continue
      }
      if (char === " ") {
        parts.push(" ")
        continue
      }
      parts.push(fg, char, RESET)
    }
    return parts.join("")
  }
  glyphs.left.forEach((row, index) => {
    if (pad) result.push(pad)
    result.push(draw(row, LogoColor.LEFT_FG, LogoColor.LEFT_SHADOW, LogoColor.LEFT_BG))
    result.push(gap)
    const other = glyphs.right[index] ?? ""
    result.push(draw(other, LogoColor.RIGHT_FG, LogoColor.RIGHT_SHADOW, LogoColor.RIGHT_BG))
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

export * as UI from "./ui"
