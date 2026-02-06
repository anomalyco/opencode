import { EOL } from "os"

const LOGO: [string, string][] = [
  [`\u00a0                   `, `             ▄     `],
  [`█▀▀█ █▀▀█ █▀▀█ █▀▀▄ `, `█▀▀▀ █▀▀█ █▀▀█ █▀▀█`],
  [`█░░█ █░░█ █▀▀▀ █░░█ `, `█░░░ █░░█ █░░█ █▀▀▀`],
  [`▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ `, `▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`],
]

export function getForkCliLogo(pad?: string): string | undefined {
  const result: string[] = []
  for (const row of LOGO) {
    if (pad) result.push(pad)
    result.push(Bun.color("gray", "ansi") ?? "")
    result.push(row[0])
    result.push("\x1b[0m")
    result.push(row[1])
    result.push(EOL)
  }
  return result.join("").trimEnd()
}
