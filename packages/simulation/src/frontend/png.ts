/// <reference path="../assets.d.ts" />
import { GlobalFonts, createCanvas, type SKRSContext2D } from "@napi-rs/canvas"
import { TextAttributes, type CapturedFrame, type CliRenderer, type RGBA } from "@opentui/core"
import regularFont from "@fontsource/commit-mono/files/commit-mono-latin-400-normal.woff2" with { type: "file" }
import boldFont from "@fontsource/commit-mono/files/commit-mono-latin-700-normal.woff2" with { type: "file" }
import italicFont from "@fontsource/commit-mono/files/commit-mono-latin-400-italic.woff2" with { type: "file" }
import boldItalicFont from "@fontsource/commit-mono/files/commit-mono-latin-700-italic.woff2" with { type: "file" }

const CellWidth = 10
const CellHeight = 20
const FontSize = 16
const FontFamily = "OpenCode Mono"

for (const file of [regularFont, boldFont, italicFont, boldItalicFont]) {
  const font = Buffer.from(await Bun.file(file).arrayBuffer())
  if (!GlobalFonts.register(font, FontFamily))
    throw new Error(`Failed to register screenshot font: ${file}`)
}

export function screenshot(renderer: CliRenderer) {
  return screenshotFrame({
    cols: renderer.currentRenderBuffer.width,
    rows: renderer.currentRenderBuffer.height,
    cursor: [0, 0],
    lines: renderer.currentRenderBuffer.getSpanLines(),
  })
}

export function screenshotFrame(frame: CapturedFrame) {
  const canvas = createCanvas(frame.cols * CellWidth, frame.rows * CellHeight)
  const context = canvas.getContext("2d")
  context.fillStyle = "#080808"
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.textBaseline = "top"

  frame.lines.forEach((line, row) => {
    let column = 0
    line.spans.forEach((span) => {
      const attributes = span.attributes & 0xff
      const inverse = Boolean(attributes & TextAttributes.INVERSE)
      const hidden = Boolean(attributes & TextAttributes.HIDDEN)
      const foreground = inverse ? span.bg : span.fg
      const background = inverse ? span.fg : span.bg
      const chars = [...span.text]
      let remaining = span.width

      chars.forEach((char, index) => {
        const cells = Math.max(1, remaining - (chars.length - index - 1))
        if (background.a) {
          context.fillStyle = color(background)
          context.fillRect(column * CellWidth, row * CellHeight, cells * CellWidth, CellHeight)
        }
        if (!hidden && char.codePointAt(0) !== 0x0a00) {
          context.fillStyle = color(foreground, attributes & TextAttributes.DIM ? 0.55 : 1)
          const x = column * CellWidth
          const y = row * CellHeight
          if (!drawBlockElement(context, char, x, y, cells)) {
            context.font = `${attributes & TextAttributes.ITALIC ? "italic " : ""}${attributes & TextAttributes.BOLD ? "bold " : ""}${FontSize}px "${FontFamily}"`
            context.fillText(char, x, y + 1)
          }
          if (attributes & TextAttributes.UNDERLINE) {
            context.fillRect(x, y + 17, cells * CellWidth, 1)
          }
          if (attributes & TextAttributes.STRIKETHROUGH) {
            context.fillRect(x, y + 10, cells * CellWidth, 1)
          }
        }
        column += cells
        remaining -= cells
      })
      while (remaining-- > 0) {
        if (background.a) {
          context.fillStyle = color(background)
          context.fillRect(column * CellWidth, row * CellHeight, CellWidth, CellHeight)
        }
        column++
      }
    })
  })

  return {
    width: canvas.width,
    height: canvas.height,
    data: canvas.toBuffer("image/png"),
  }
}

function drawBlockElement(context: SKRSContext2D, char: string, x: number, y: number, cells: number) {
  const width = cells * CellWidth
  if (char === "█") context.fillRect(x, y, width, CellHeight)
  else if (char === "▀") context.fillRect(x, y, width, CellHeight / 2)
  else if (char === "▄") context.fillRect(x, y + CellHeight / 2, width, CellHeight / 2)
  else return false
  return true
}

function color(value: RGBA, opacity = 1) {
  const [red, green, blue, alpha] = value.toInts()
  return `rgba(${red}, ${green}, ${blue}, ${(alpha / 255) * opacity})`
}

export * as SimulationPng from "./png"
