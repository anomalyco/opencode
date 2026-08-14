/**
 * Generates Open Graph cards for the catalog: one 1200x630 PNG per captured
 * screen/theme pair plus a default card, written to dist/og. Runs after the
 * production build so the images deploy as plain static assets.
 */
import { fileURLToPath } from "node:url"
import { GlobalFonts, createCanvas } from "@napi-rs/canvas"
import type { SKRSContext2D, Canvas } from "@napi-rs/canvas"
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
} from "opencode-drive/frame"

const CardWidth = 1200
const CardHeight = 630
const Pad = 56

const FontStack = `"OpenCode Mono", "OpenCode Symbols", "OpenCode Symbols 2", "OpenCode Math"`

const driveRoot = new URL("../../", Bun.pathToFileURL(Bun.resolveSync("opencode-drive/frame", import.meta.dir)).href)
for (const [file, family] of [
  ["commit-mono/CommitMono-400-Regular.otf", "OpenCode Mono"],
  ["commit-mono/CommitMono-700-Regular.otf", "OpenCode Mono"],
  ["commit-mono/CommitMono-400-Italic.otf", "OpenCode Mono"],
  ["commit-mono/CommitMono-700-Italic.otf", "OpenCode Mono"],
  ["noto/NotoSansSymbols.ttf", "OpenCode Symbols"],
  ["noto/NotoSansSymbols2-Regular.ttf", "OpenCode Symbols 2"],
  ["noto/NotoSansMath-Regular.ttf", "OpenCode Math"],
] as const) {
  const path = fileURLToPath(new URL(`assets/fonts/${file}`, driveRoot))
  if (!GlobalFonts.registerFromPath(path, family)) throw new Error(`Failed to register OG font: ${path}`)
}

interface FrameSpan {
  readonly text: string
  readonly fg: readonly [number, number, number, number]
  readonly bg: readonly [number, number, number, number]
  readonly attributes: number
  readonly width: number
}

interface FrameArtifact {
  readonly cols: number
  readonly rows: number
  readonly lines: ReadonlyArray<{ readonly spans: ReadonlyArray<FrameSpan> }>
}

function color([red, green, blue, alpha]: FrameSpan["fg"], opacity = 1) {
  return `rgba(${red}, ${green}, ${blue}, ${(alpha / 255) * opacity})`
}

/** Mirrors the browser canvas renderer in src/components/TerminalFrame.tsx. */
function renderFrame(frame: FrameArtifact) {
  const canvas = createCanvas(frame.cols * CellWidth, frame.rows * CellHeight)
  const context = canvas.getContext("2d")
  context.fillStyle = "#080808"
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.textBaseline = "alphabetic"
  context.textAlign = "center"

  frame.lines.forEach((line, row) => {
    let column = 0
    line.spans.forEach((span) => {
      const attributes = span.attributes & 0xff
      const inverse = Boolean(attributes & TextStyle.inverse)
      const hidden = Boolean(attributes & TextStyle.invisible)
      const foreground = inverse ? span.bg : span.fg
      const background = inverse ? span.fg : span.bg
      const chars = [...span.text]
      let remaining = span.width

      chars.forEach((char, index) => {
        const cells = Math.max(1, remaining - (chars.length - index - 1))
        const x = column * CellWidth
        const y = row * CellHeight
        if (background[3]) {
          context.fillStyle = color(background)
          context.fillRect(x, y, cells * CellWidth, CellHeight)
        }
        if (!hidden && char.codePointAt(0) !== 0x0a00) {
          context.fillStyle = color(foreground, attributes & TextStyle.dim ? DimAlpha : 1)
          if (!drawBlockGlyph(context, char, x, y, cells)) {
            const font = `${attributes & TextStyle.italic ? "italic " : ""}${attributes & TextStyle.bold ? "700 " : "400 "}${FontSize}px ${FontStack}`
            context.font = font
            context.fillText(char, x + (cells * CellWidth) / 2, y + baselineOffset(context, font), cells * CellWidth)
          }
          if (attributes & TextStyle.underline) context.fillRect(x, y + UnderlineOffset, cells * CellWidth, 1)
          if (attributes & TextStyle.strikethrough) context.fillRect(x, y + StrikethroughOffset, cells * CellWidth, 1)
        }
        column += cells
        remaining -= cells
      })
      while (remaining-- > 0) {
        if (background[3]) {
          context.fillStyle = color(background)
          context.fillRect(column * CellWidth, row * CellHeight, CellWidth, CellHeight)
        }
        column++
      }
    })
  })
  return canvas
}

function drawChrome(context: SKRSContext2D, kicker: string, title: string, chip: string) {
  context.fillStyle = "#0a0a0a"
  context.fillRect(0, 0, CardWidth, CardHeight)

  context.textAlign = "left"
  context.textBaseline = "alphabetic"
  context.font = `700 20px ${FontStack}`
  context.fillStyle = "#6f6e69"
  context.fillText(kicker.toUpperCase(), Pad, Pad + 16)

  context.font = `700 46px ${FontStack}`
  context.fillStyle = "#ededed"
  context.fillText(title, Pad - 2, Pad + 74, CardWidth - Pad * 2 - 220)

  if (chip !== "") {
    context.font = `400 20px ${FontStack}`
    const width = context.measureText(chip).width + 36
    const x = CardWidth - Pad - width
    context.strokeStyle = "#2c2c2c"
    context.lineWidth = 1
    context.beginPath()
    context.roundRect(x, Pad + 38, width, 40, 20)
    context.stroke()
    context.fillStyle = "#9c9b96"
    context.fillText(chip, x + 18, Pad + 65)
  }
}

/** Frame peeks from the bottom edge like a window, cropped by the card. */
function drawFramePeek(context: SKRSContext2D, frame: Canvas) {
  const top = 182
  const width = CardWidth - Pad * 2
  const scale = width / frame.width
  const visible = CardHeight - top
  const radius = 10

  context.save()
  context.beginPath()
  context.roundRect(Pad, top, width, visible + radius, radius)
  context.clip()
  context.drawImage(
    frame,
    0,
    0,
    frame.width,
    Math.min(frame.height, (visible + radius) / scale),
    Pad,
    top,
    width,
    Math.min(frame.height * scale, visible + radius),
  )
  context.restore()

  context.strokeStyle = "#2c2c2c"
  context.lineWidth = 2
  context.beginPath()
  context.roundRect(Pad + 1, top + 1, width - 2, visible + radius, radius)
  context.stroke()
}

const root = new URL("../", import.meta.url)
const outDir = new URL("dist/og/", root)
const catalog = await Bun.file(new URL("dist/catalog.json", root)).json()

const variants = catalog.variants as ReadonlyArray<{ id: string; label: string }>
const screens = catalog.screens as ReadonlyArray<{
  id: string
  title: string
  frames: ReadonlyArray<{ variantId: string; src: string }>
}>

let generated = 0
for (const screen of screens) {
  for (const frame of screen.frames) {
    const variant = variants.find((candidate) => candidate.id === frame.variantId)
    if (!variant) continue
    const artifact = (await Bun.file(new URL(frame.src, new URL("dist/", root))).json()) as FrameArtifact
    const card = createCanvas(CardWidth, CardHeight)
    const context = card.getContext("2d")
    drawChrome(context, "OpenCode · Terminal Catalog", screen.title, variant.label)
    drawFramePeek(context, renderFrame(artifact))
    await Bun.write(new URL(`${screen.id}--${variant.id}.png`, outDir), card.toBuffer("image/png"))
    generated++
  }
}

const home = screens.find((screen) => screen.id === "home")
const homeFrame = home?.frames.find((frame) => frame.variantId === variants[0]?.id) ?? home?.frames[0]
const card = createCanvas(CardWidth, CardHeight)
const context = card.getContext("2d")
drawChrome(context, "OpenCode", "Terminal Catalog", `${screens.length} screens · ${variants.length} themes`)
if (homeFrame) {
  const artifact = (await Bun.file(new URL(homeFrame.src, new URL("dist/", root))).json()) as FrameArtifact
  drawFramePeek(context, renderFrame(artifact))
}
await Bun.write(new URL("default.png", outDir), card.toBuffer("image/png"))

console.log(`generated ${generated + 1} Open Graph cards in dist/og`)
