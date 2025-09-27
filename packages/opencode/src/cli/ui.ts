import z from "zod/v4"
import { EOL } from "os"
import { NamedError } from "../util/error"

export namespace UI {
  const LOGO = [
    [`🎯 `, `███████╗██╗   ██╗ █████╗ ██╗      ██████╗ ██████╗ ███████╗`],
    [`  `, `██╔════╝██║   ██║██╔══██╗██║     ██╔═══██╗██╔══██╗██╔════╝`],
    [`  `, `█████╗  ██║   ██║███████║██║     ██║   ██║██████╔╝███████╗`],
    [`  `, `██╔══╝  ╚██╗ ██╔╝██╔══██║██║     ██║   ██║██╔═══╝ ╚════██║`],
    [`  `, `███████╗ ╚████╔╝ ██║  ██║███████╗╚██████╔╝██║     ███████║`],
    [`  `, `╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝     ╚══════╝`],
    [`  `, `                    Trust, but Verify™`],
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
    const result = []
    const colors = [
      "\x1b[38;5;99m",  // Indigo
      "\x1b[38;5;105m", // Light indigo
      "\x1b[38;5;141m", // Purple
      "\x1b[38;5;147m", // Light purple
      "\x1b[38;5;183m", // Light purple
      "\x1b[38;5;219m", // Very light purple
      "\x1b[38;5;245m", // Gray for tagline
    ]
    for (let i = 0; i < LOGO.length; i++) {
      const row = LOGO[i]
      if (pad) result.push(pad)
      result.push(row[0])
      result.push(colors[i] || "\x1b[38;5;99m")
      result.push(row[1])
      result.push("\x1b[0m")
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
