import { fileURLToPath } from "node:url"
import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas"
import {
  CellHeight,
  CellWidth,
  DimAlpha,
  FontSize,
  StrikethroughOffset,
  TextStyle,
  UnderlineOffset,
  baselineOffset,
  drawBlockGlyph,
} from "../frame/index.js"
import type { CapturedFrame } from "./types.js"

export { CellHeight, CellWidth } from "../frame/index.js"

const FontFamily = "OpenCode Mono"
const SymbolFontFamily = "OpenCode Symbols"
const SymbolFontFamily2 = "OpenCode Symbols 2"
const MathFontFamily = "OpenCode Math"
const FontStack = `"${FontFamily}", "${SymbolFontFamily}", "${SymbolFontFamily2}", "${MathFontFamily}"`

const fontOverride = process.env["OPENCODE_DRIVE_FONT"]
const fontFiles = fontOverride
  ? fontOverride
      .split(",")
      .map((file) => file.trim())
      .filter(Boolean)
  : [
      "CommitMono-400-Regular.otf",
      "CommitMono-700-Regular.otf",
      "CommitMono-400-Italic.otf",
      "CommitMono-700-Italic.otf",
    ].map((file) => fileURLToPath(new URL(`../../assets/fonts/commit-mono/${file}`, import.meta.url)))

if (fontFiles.length === 0)
  throw new Error("OPENCODE_DRIVE_FONT must contain at least one font file")
for (const file of fontFiles) {
  if (!GlobalFonts.registerFromPath(file, FontFamily))
    throw new Error(`Failed to register capture font: ${file}`)
}
for (const [file, family] of [
  ["NotoSansSymbols.ttf", SymbolFontFamily],
  ["NotoSansSymbols2-Regular.ttf", SymbolFontFamily2],
  ["NotoSansMath-Regular.ttf", MathFontFamily],
] as const) {
  const path = fileURLToPath(new URL(`../../assets/fonts/noto/${file}`, import.meta.url))
  if (!GlobalFonts.registerFromPath(path, family))
    throw new Error(`Failed to register capture symbol font: ${path}`)
}

function color(rgb: number, alpha = 1) {
  return `rgba(${(rgb >> 16) & 255}, ${(rgb >> 8) & 255}, ${rgb & 255}, ${alpha})`
}

export interface RenderFrameOptions {
  readonly cols?: number
  readonly rows?: number
  readonly header?: string
}

export function renderFrame(frame: CapturedFrame, options: RenderFrameOptions = {}): Buffer {
  const cols = Math.max(frame.cols, options.cols ?? frame.cols)
  const rows = Math.max(frame.rows, options.rows ?? frame.rows)
  const headerHeight = options.header ? 40 : 0
  const canvas = createCanvas(cols * CellWidth, rows * CellHeight + headerHeight)
  const context = canvas.getContext("2d")
  context.fillStyle = "#080808"
  context.fillRect(0, 0, canvas.width, canvas.height)
  if (options.header) {
    context.fillStyle = "#151515"
    context.fillRect(0, 0, canvas.width, headerHeight)
    context.font = `700 ${FontSize}px ${FontStack}`
    context.fillStyle = "#d8d8d8"
    context.textBaseline = "middle"
    context.textAlign = "left"
    context.fillText(options.header, 16, headerHeight / 2, canvas.width - 32)
  }
  context.textBaseline = "alphabetic"
  context.textAlign = "center"

  frame.lines.forEach((line, row) => {
    let column = 0
    for (const span of line.spans) {
      const inverse = Boolean(span.attributes & TextStyle.inverse)
      const hidden = Boolean(span.attributes & TextStyle.invisible)
      const foreground = inverse ? span.bg : span.fg
      const background = inverse ? span.fg : span.bg
      const y = headerHeight + row * CellHeight
      context.fillStyle = color(background)
      context.fillRect(column * CellWidth, y, span.width * CellWidth, CellHeight)
      if (hidden) {
        column += span.width
        continue
      }
      const italic = span.attributes & TextStyle.italic ? "italic " : ""
      const weight = span.attributes & TextStyle.bold ? "700 " : "400 "
      const font = `${italic}${weight}${FontSize}px ${FontStack}`
      context.font = font
      context.fillStyle = color(foreground, span.attributes & TextStyle.dim ? DimAlpha : 1)
      const baseline = baselineOffset(context, font)
      let remaining = span.width
      for (const char of span.text) {
        const cells = Math.min(Math.max(1, Bun.stringWidth(char)), remaining)
        const x = column * CellWidth
        if (!drawBlockGlyph(context, char, x, y, cells))
          context.fillText(
            char,
            x + (cells * CellWidth) / 2,
            y + baseline,
            cells * CellWidth,
          )
        if (span.attributes & TextStyle.underline) {
          context.fillRect(x, y + UnderlineOffset, cells * CellWidth, 1)
        }
        if (span.attributes & TextStyle.strikethrough) {
          context.fillRect(x, y + StrikethroughOffset, cells * CellWidth, 1)
        }
        column += cells
        remaining -= cells
      }
      if (remaining > 0) {
        column += remaining
      }
    }
  })

  if (frame.cursor.visible && frame.cursor.row >= 0 && frame.cursor.row < frame.rows) {
    context.strokeStyle = "#d8d8d8"
    context.lineWidth = 2
    context.strokeRect(
      frame.cursor.col * CellWidth + 1,
      headerHeight + frame.cursor.row * CellHeight + 1,
      CellWidth - 2,
      CellHeight - 2,
    )
  }
  return canvas.toBuffer("image/png")
}

export async function joinFrames(left: Buffer, right: Buffer): Promise<Buffer> {
  const [leftImage, rightImage] = await Promise.all([loadImage(left), loadImage(right)])
  if (leftImage.height !== rightImage.height)
    throw new Error(
      `comparison recordings must have the same height: ${leftImage.height} !== ${rightImage.height}`,
    )
  const canvas = createCanvas(leftImage.width + rightImage.width, leftImage.height)
  const context = canvas.getContext("2d")
  context.drawImage(leftImage, 0, 0)
  context.drawImage(rightImage, leftImage.width, 0)
  return canvas.toBuffer("image/png")
}
