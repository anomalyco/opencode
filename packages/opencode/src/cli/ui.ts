import z from "zod"
import { EOL } from "os"
import { NamedError } from "@opencode-ai/util/error"
import { logo as glyphs } from "./logo"

export namespace UI {
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

  export function logo(pad?: string) {
    const result: string[] = []
    const reset = "\x1b[0m"

    // Classic Lash gradient: pink (Dolly #FF60FF) → indigo (Charple #6B50FF)
    const gradA = { r: 255, g: 96, b: 255 }
    const gradB = { r: 107, g: 80, b: 255 }
    const stripeColor = "\x1b[38;2;107;80;255m"
    const diag = "╱"
    const leftStripes = 6
    const rightStripesBase = 15

    const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t)

    const drawGradient = (line: string) => {
      const totalLen = line.length
      const parts: string[] = []
      for (let i = 0; i < line.length; i++) {
        const t = totalLen > 1 ? i / (totalLen - 1) : 0
        const r = lerp(gradA.r, gradB.r, t)
        const g = lerp(gradA.g, gradB.g, t)
        const b = lerp(gradA.b, gradB.b, t)
        const fg = `\x1b[38;2;${r};${g};${b}m`
        const sr = Math.round(r * 0.25)
        const sg = Math.round(g * 0.25)
        const sb = Math.round(b * 0.25)
        const shadowFg = `\x1b[38;2;${sr};${sg};${sb}m`
        const shadowBg = `\x1b[48;2;${sr};${sg};${sb}m`
        const char = line[i]
        if (char === "_") {
          parts.push(fg, shadowBg, " ", reset)
        } else if (char === "^") {
          parts.push(fg, shadowBg, "▀", reset)
        } else if (char === "~") {
          parts.push(shadowFg, "▀", reset)
        } else if (char === " ") {
          parts.push(" ")
        } else {
          parts.push(fg, char, reset)
        }
      }
      return parts.join("")
    }

    glyphs.left.forEach((row, index) => {
      if (pad) result.push(pad)
      result.push(stripeColor, diag.repeat(leftStripes), reset, " ")
      const combined = row + " " + (glyphs.right[index] ?? "")
      result.push(drawGradient(combined))
      const rightStripes = rightStripesBase - index
      result.push(" ", stripeColor, diag.repeat(rightStripes), reset)
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
    println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
  }

  export function markdown(text: string): string {
    return text
  }
}
