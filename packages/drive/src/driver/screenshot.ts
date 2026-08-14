import { extname, join, resolve } from "node:path"
import { mkdir } from "node:fs/promises"
import type { Frontend } from "../client/protocol.js"
import type { CapturedFrame } from "../recording/types.js"

export async function renderScreenshot(frame: Frontend.CapturedFrame, directory: string, name?: string) {
  const filename = name ?? `screenshot-${crypto.randomUUID()}`
  if (!filename || filename.includes("/") || filename.includes("\\") || extname(filename))
    throw new Error("screenshot name must not contain a path or extension")
  const { renderFrame } = await import("../recording/render.js")
  const output = resolve(directory)
  await mkdir(output, { recursive: true })
  const path = join(output, `${filename}.png`)
  await Bun.write(path, renderFrame(convert(frame)))
  return path
}

function convert(frame: Frontend.CapturedFrame): CapturedFrame {
  return {
    cols: frame.cols,
    rows: frame.rows,
    cursor: { col: frame.cursor[0], row: frame.cursor[1], visible: false },
    lines: frame.lines.map((line) => ({
      spans: line.spans.map((span) => ({
        text: span.text,
        width: span.width,
        fg: rgb(span.fg),
        bg: rgb(span.bg),
        attributes: span.attributes,
      })),
    })),
  }
}

function rgb(color: Frontend.Color) {
  return (color[0] << 16) | (color[1] << 8) | color[2]
}
