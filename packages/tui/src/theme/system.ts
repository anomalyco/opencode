import { RGBA, type TerminalColors } from "@opentui/core"
import { ansiToRgba, tint } from "./color"

export function terminalMode(colors: TerminalColors): "dark" | "light" | undefined {
  const bg = colors.defaultBackground
  if (!bg) return
  const { r, g, b } = RGBA.fromHex(bg)
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.5 ? "light" : "dark"
}

export function generateSystem(colors: TerminalColors, mode: "dark" | "light") {
  const bg = RGBA.fromHex(colors.defaultBackground ?? colors.palette[0]!)
  const fg = RGBA.fromHex(colors.defaultForeground ?? colors.palette[7]!)
  const transparent = RGBA.fromValues(bg.r, bg.g, bg.b, 0)
  const isDark = mode === "dark"

  const col = (index: number) => {
    const value = colors.palette[index]
    if (value) return RGBA.fromHex(value)
    return ansiToRgba(index)
  }

  const grays = generateGrayScale(bg, isDark)
  const textMuted = generateMutedTextColor(bg, isDark)
  const ansiColors = {
    red: col(1),
    green: col(2),
    yellow: col(3),
    blue: col(4),
    magenta: col(5),
    cyan: col(6),
    redBright: col(9),
    greenBright: col(10),
  }

  const diffAlpha = isDark ? 0.22 : 0.14
  const diffAddedBg = tint(bg, ansiColors.green, diffAlpha)
  const diffRemovedBg = tint(bg, ansiColors.red, diffAlpha)
  const diffContextBg = grays[2]
  const diffAddedLineNumberBg = tint(diffContextBg, ansiColors.green, diffAlpha)
  const diffRemovedLineNumberBg = tint(diffContextBg, ansiColors.red, diffAlpha)

  return {
    theme: {
      primary: ansiColors.cyan,
      secondary: ansiColors.magenta,
      accent: ansiColors.cyan,
      error: ansiColors.red,
      warning: ansiColors.yellow,
      success: ansiColors.green,
      info: ansiColors.cyan,
      text: fg,
      textMuted,
      selectedListItemText: bg,
      background: transparent,
      backgroundPanel: grays[2],
      backgroundElement: grays[3],
      backgroundMenu: grays[3],
      borderSubtle: grays[6],
      border: grays[7],
      borderActive: grays[8],
      diffAdded: ansiColors.green,
      diffRemoved: ansiColors.red,
      diffContext: grays[7],
      diffHunkHeader: grays[7],
      diffHighlightAdded: ansiColors.greenBright,
      diffHighlightRemoved: ansiColors.redBright,
      diffAddedBg,
      diffRemovedBg,
      diffContextBg,
      diffLineNumber: textMuted,
      diffAddedLineNumberBg,
      diffRemovedLineNumberBg,
      markdownText: fg,
      markdownHeading: fg,
      markdownLink: ansiColors.blue,
      markdownLinkText: ansiColors.cyan,
      markdownCode: ansiColors.green,
      markdownBlockQuote: ansiColors.yellow,
      markdownEmph: ansiColors.yellow,
      markdownStrong: fg,
      markdownHorizontalRule: grays[7],
      markdownListItem: ansiColors.blue,
      markdownListEnumeration: ansiColors.cyan,
      markdownImage: ansiColors.blue,
      markdownImageText: ansiColors.cyan,
      markdownCodeBlock: fg,
      syntaxComment: textMuted,
      syntaxKeyword: ansiColors.magenta,
      syntaxFunction: ansiColors.blue,
      syntaxVariable: fg,
      syntaxString: ansiColors.green,
      syntaxNumber: ansiColors.yellow,
      syntaxType: ansiColors.cyan,
      syntaxOperator: ansiColors.cyan,
      syntaxPunctuation: fg,
    },
  }
}

function generateGrayScale(bg: RGBA, isDark: boolean): Record<number, RGBA> {
  const grays: Record<number, RGBA> = {}
  const bgR = bg.r * 255
  const bgG = bg.g * 255
  const bgB = bg.b * 255
  const luminance = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB

  for (let i = 1; i <= 12; i++) {
    const factor = i / 12

    if (isDark && luminance < 10) {
      const gray = Math.floor(factor * 0.4 * 255)
      grays[i] = RGBA.fromInts(gray, gray, gray)
      continue
    }

    if (!isDark && luminance > 245) {
      const gray = Math.floor(255 - factor * 0.4 * 255)
      grays[i] = RGBA.fromInts(gray, gray, gray)
      continue
    }

    const next = isDark ? luminance + (255 - luminance) * factor * 0.4 : luminance * (1 - factor * 0.4)
    const ratio = next / luminance
    grays[i] = RGBA.fromInts(
      Math.floor(Math.min(Math.max(bgR * ratio, 0), 255)),
      Math.floor(Math.min(Math.max(bgG * ratio, 0), 255)),
      Math.floor(Math.min(Math.max(bgB * ratio, 0), 255)),
    )
  }

  return grays
}

function generateMutedTextColor(bg: RGBA, isDark: boolean): RGBA {
  const luminance = 0.299 * bg.r * 255 + 0.587 * bg.g * 255 + 0.114 * bg.b * 255
  if (isDark) {
    const gray = luminance < 10 ? 180 : Math.min(Math.floor(160 + luminance * 0.3), 200)
    return RGBA.fromInts(gray, gray, gray)
  }

  const gray = luminance > 245 ? 75 : Math.max(Math.floor(100 - (255 - luminance) * 0.2), 60)
  return RGBA.fromInts(gray, gray, gray)
}
