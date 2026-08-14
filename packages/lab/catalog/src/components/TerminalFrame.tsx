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
import { useEffect, useRef } from "react"
import type { Frame, FrameArtifact } from "../../catalog/schema"
import { catalogBasePath } from "../base-path"

interface TerminalFrameProps {
  readonly frame: Frame
  readonly label: string
  readonly lazy?: boolean
}

const FontFamily = "Commit Mono"
const SymbolFontFamily = "Noto Sans Symbols"
const SymbolFontFamily2 = "Noto Sans Symbols 2"
const MathFontFamily = "Noto Sans Math"
const FontStack = `"${FontFamily}", "${SymbolFontFamily}", "${SymbolFontFamily2}", "${MathFontFamily}"`
const cache = new Map<string, Promise<FrameArtifact>>()
let fontsReady: Promise<unknown> | undefined

export function preloadFrame(frame: Frame) {
  return loadFrame(frame.src)
}

export function TerminalFrame({ frame, label, lazy = false }: TerminalFrameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    const render = async () => {
      if (lazy && !isNearViewport(canvas)) return
      const artifact = await loadFrame(frame.src)
      fontsReady ??= Promise.all([
        document.fonts.load(`400 ${FontSize}px "${FontFamily}"`),
        document.fonts.load(`700 ${FontSize}px "${FontFamily}"`),
        document.fonts.load(`400 ${FontSize}px "${SymbolFontFamily}"`, "⚙"),
        document.fonts.load(`700 ${FontSize}px "${SymbolFontFamily}"`, "⚙"),
        document.fonts.load(`400 ${FontSize}px "${SymbolFontFamily2}"`, "△✱⬝"),
        document.fonts.load(`400 ${FontSize}px "${MathFontFamily}"`, "⇆↳⟳"),
      ])
      await fontsReady
      if (!cancelled) drawFrame(canvas, artifact)
    }
    let observer: IntersectionObserver | undefined
    observer = lazy
      ? new IntersectionObserver(
          (entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return
            observer?.disconnect()
            void render()
          },
          { rootMargin: "300px" },
        )
      : undefined
    if (observer) observer.observe(canvas)
    else void render()
    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [frame.src, lazy])

  return (
    <canvas
      ref={canvasRef}
      width={frame.cols * CellWidth}
      height={frame.rows * CellHeight}
      role="img"
      aria-label={label}
    />
  )
}

function loadFrame(src: string) {
  const existing = cache.get(src)
  if (existing) return existing
  const pending = fetch(`${catalogBasePath()}${src}`).then(async (response) => {
    if (!response.ok) throw new Error(`Failed to load terminal frame: ${response.status}`)
    return response.json() as Promise<FrameArtifact>
  })
  cache.set(src, pending)
  return pending
}

function drawFrame(canvas: HTMLCanvasElement, frame: FrameArtifact) {
  const context = canvas.getContext("2d")
  if (!context) return
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
}

function color([red, green, blue, alpha]: FrameArtifact["lines"][number]["spans"][number]["fg"], opacity = 1) {
  return `rgba(${red}, ${green}, ${blue}, ${(alpha / 255) * opacity})`
}

function isNearViewport(element: HTMLElement) {
  const bounds = element.getBoundingClientRect()
  return bounds.bottom >= -300 && bounds.top <= window.innerHeight + 300
}
