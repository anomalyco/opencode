import { EOL } from "os"

// Simple text logo — no special glyph rendering
export const wordmark = [
  "  ___ ___ _  _     _   ___ ",
  " | _ \\_ _| \\| |   /_\\ |_ _|",
  " |   /| || .` |  / _ \\ | | ",
  " |_|_\\___|_|\\_| /_/ \\_\\___|",
]

export function renderLogo(pad?: string): string {
  const result: string[] = []
  for (const row of wordmark) {
    if (pad) result.push(pad)
    result.push("\x1b[36m")  // cyan
    result.push(row)
    result.push("\x1b[0m")   // reset
    result.push(EOL)
  }
  // Credits line
  if (pad) result.push(pad)
  result.push("\x1b[90m")  // dim
  result.push("TG: t.me/RinquicklyBot  |  DC: discord.gg/K98kCm6CVf")
  result.push("\x1b[0m")
  result.push(EOL)
  return result.join("").trimEnd()
}

export const logo = {
  left: ["", "", "", ""],
  right: ["", "", "", ""],
}

export const go = {
  left: ["", "", "", ""],
  right: ["", "", "", ""],
}

export const marks = ""
