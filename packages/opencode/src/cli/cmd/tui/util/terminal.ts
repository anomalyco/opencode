import { RGBA } from "@opentui/core"

export type Colors = Awaited<ReturnType<typeof colors>>

function parse(color: string): RGBA | null {
  if (color.startsWith("rgb:")) {
    const parts = color.substring(4).split("/")
    return RGBA.fromInts(parseInt(parts[0], 16) >> 8, parseInt(parts[1], 16) >> 8, parseInt(parts[2], 16) >> 8, 255)
  }
  if (color.startsWith("#")) {
    return RGBA.fromHex(color)
  }
  if (color.startsWith("rgb(")) {
    const parts = color.substring(4, color.length - 1).split(",")
    return RGBA.fromInts(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]), 255)
  }
  return null
}

/**
 * Query terminal colors including background, foreground, and palette (0-15).
 * Uses OSC escape sequences to retrieve actual terminal color values.
 *
 * Note: OSC 4 (palette) queries may not work through tmux as responses are filtered.
 * OSC 10/11 (foreground/background) typically work in most environments.
 *
 * Returns an object with background, foreground, and colors array.
 * Any query that fails will be null/empty.
 */
export async function colors(): Promise<{
  background: RGBA | null
  foreground: RGBA | null
  colors: RGBA[]
}> {
  if (!process.stdin.isTTY) return { background: null, foreground: null, colors: [] }

  return new Promise((resolve) => {
    let background: RGBA | null = null
    let foreground: RGBA | null = null
    const paletteColors: RGBA[] = []
    let timeout: NodeJS.Timeout

    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.removeListener("data", handler)
      clearTimeout(timeout)
    }

    const handler = (data: Buffer) => {
      const str = data.toString()

      // Match OSC 11 (background color)
      const bgMatch = str.match(/\x1b]11;([^\x07\x1b]+)/)
      if (bgMatch) {
        background = parse(bgMatch[1])
      }

      // Match OSC 10 (foreground color)
      const fgMatch = str.match(/\x1b]10;([^\x07\x1b]+)/)
      if (fgMatch) {
        foreground = parse(fgMatch[1])
      }

      // Match OSC 4 (palette colors)
      const paletteMatches = str.matchAll(/\x1b]4;(\d+);([^\x07\x1b]+)/g)
      for (const match of paletteMatches) {
        const index = parseInt(match[1])
        const color = parse(match[2])
        if (color) paletteColors[index] = color
      }

      // Return immediately if we have all 16 palette colors
      if (paletteColors.filter((c) => c !== undefined).length === 16) {
        cleanup()
        resolve({ background, foreground, colors: paletteColors })
      }
    }

    process.stdin.setRawMode(true)
    process.stdin.on("data", handler)

    // Query background (OSC 11)
    process.stdout.write("\x1b]11;?\x07")
    // Query foreground (OSC 10)
    process.stdout.write("\x1b]10;?\x07")
    // Query palette colors 0-15 (OSC 4)
    for (let i = 0; i < 16; i++) {
      process.stdout.write(`\x1b]4;${i};?\x07`)
    }

    timeout = setTimeout(() => {
      cleanup()
      resolve({ background, foreground, colors: paletteColors })
    }, 1000)
  })
}
