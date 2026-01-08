import sharp from "sharp"
import { Log } from "@/util/log"
import { BrowserManager, type ElementBounds, type InteractiveElement } from "./manager"

const log = Log.create({ service: "browser.annotate" })

export interface AnnotationOptions {
  /** Draw a cursor pointer at this position */
  cursorPos?: { x: number; y: number }
  /** Draw highlight boxes around elements matching these selectors */
  highlights?: Array<{ selector: string; color?: string; label?: string }>
  /** Number interactive elements on the screenshot */
  numberElements?: boolean | { type?: "all" | "clickable" | "input"; viewportOnly?: boolean }
  /** Draw an arrow between two points */
  arrows?: Array<{ from: { x: number; y: number }; to: { x: number; y: number }; color?: string }>
  /** Draw boxes at specific coordinates */
  boxes?: Array<{ bounds: ElementBounds; color?: string; label?: string }>
  /** Quality for PNG output (0-100) */
  quality?: number
}

export interface AnnotationResult {
  /** Annotated image as base64 data URL */
  dataUrl: string
  /** Element index to selector mapping (when numberElements is true) */
  elementMap?: Map<number, { selector: string; element: InteractiveElement }>
}

// Colors for element numbering
const ELEMENT_COLORS = [
  "#FF6B6B", // Red
  "#4ECDC4", // Teal
  "#45B7D1", // Blue
  "#96CEB4", // Green
  "#FFEAA7", // Yellow
  "#DDA0DD", // Plum
  "#98D8C8", // Mint
  "#F7DC6F", // Gold
  "#BB8FCE", // Purple
  "#85C1E9", // Sky
]

/**
 * Screenshot Annotation Module
 *
 * Provides visual grounding for browser automation by annotating screenshots
 * with cursors, highlights, numbered elements, and other visual markers.
 */
export namespace ScreenshotAnnotator {
  /**
   * Annotate a screenshot with visual markers
   */
  export async function annotate(imageBuffer: Buffer, options: AnnotationOptions): Promise<AnnotationResult> {
    const image = sharp(imageBuffer)
    const metadata = await image.metadata()
    const width = metadata.width || 1280
    const height = metadata.height || 720

    const composites: sharp.OverlayOptions[] = []
    let elementMap: Map<number, { selector: string; element: InteractiveElement }> | undefined

    // Draw highlight boxes
    if (options.highlights?.length) {
      for (const highlight of options.highlights) {
        try {
          const bounds = await BrowserManager.getElementBounds(highlight.selector)
          if (bounds) {
            const boxSvg = createBoxSvg(bounds, highlight.color ?? "#FFFF00", highlight.label)
            composites.push({
              input: Buffer.from(boxSvg),
              top: 0,
              left: 0,
            })
          }
        } catch (e) {
          log.warn("failed to highlight element", { selector: highlight.selector, error: String(e) })
        }
      }
    }

    // Draw custom boxes
    if (options.boxes?.length) {
      for (const box of options.boxes) {
        const boxSvg = createBoxSvg(box.bounds, box.color ?? "#FFFF00", box.label, width, height)
        composites.push({
          input: Buffer.from(boxSvg),
          top: 0,
          left: 0,
        })
      }
    }

    // Number interactive elements (Set-of-Marks style)
    if (options.numberElements) {
      const numberOpts = typeof options.numberElements === "object" ? options.numberElements : {}
      const elements = await BrowserManager.getInteractiveElements({
        type: numberOpts.type ?? "all",
        viewportOnly: numberOpts.viewportOnly ?? true,
      })

      elementMap = new Map()
      const elementsSvg = createNumberedElementsSvg(elements, width, height)
      composites.push({
        input: Buffer.from(elementsSvg),
        top: 0,
        left: 0,
      })

      // Build element map for reference
      for (const el of elements) {
        elementMap.set(el.index, { selector: el.selector, element: el })
      }
    }

    // Draw arrows
    if (options.arrows?.length) {
      for (const arrow of options.arrows) {
        const arrowSvg = createArrowSvg(arrow.from, arrow.to, arrow.color ?? "#FF0000", width, height)
        composites.push({
          input: Buffer.from(arrowSvg),
          top: 0,
          left: 0,
        })
      }
    }

    // Draw cursor
    if (options.cursorPos) {
      const cursorSvg = createCursorSvg(options.cursorPos.x, options.cursorPos.y, width, height)
      composites.push({
        input: Buffer.from(cursorSvg),
        top: 0,
        left: 0,
      })
    }

    // Apply all composites
    let result = image
    if (composites.length > 0) {
      result = image.composite(composites)
    }

    // Convert to PNG buffer
    const outputBuffer = await result.png({ quality: options.quality ?? 80 }).toBuffer()
    const dataUrl = `data:image/png;base64,${outputBuffer.toString("base64")}`

    return { dataUrl, elementMap }
  }

  /**
   * Annotate a base64 image
   */
  export async function annotateBase64(base64OrDataUrl: string, options: AnnotationOptions): Promise<AnnotationResult> {
    // Extract base64 data if it's a data URL
    const base64 = base64OrDataUrl.includes(",") ? base64OrDataUrl.split(",")[1] : base64OrDataUrl
    const buffer = Buffer.from(base64, "base64")
    return annotate(buffer, options)
  }

  /**
   * Create an annotated screenshot directly from the browser
   */
  export async function captureAnnotated(
    screenshotOptions?: {
      fullPage?: boolean
      selector?: string
    },
    annotationOptions?: AnnotationOptions,
  ): Promise<AnnotationResult> {
    const buffer = await BrowserManager.screenshot(screenshotOptions)

    if (!annotationOptions || Object.keys(annotationOptions).length === 0) {
      // No annotations needed, return raw screenshot
      return {
        dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
      }
    }

    return annotate(buffer, annotationOptions)
  }

  /**
   * Create SVG for cursor pointer
   */
  function createCursorSvg(x: number, y: number, width: number, height: number): string {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <g transform="translate(${x}, ${y})">
    <path fill="#FF0000" stroke="#000" stroke-width="1.5" d="M0 0 L0 20 L5 15 L9 24 L12 23 L8 14 L14 14 Z"/>
    <circle cx="0" cy="0" r="4" fill="rgba(255,0,0,0.3)" stroke="#FF0000" stroke-width="1"/>
  </g>
</svg>`
  }

  /**
   * Create SVG for highlight box
   */
  function createBoxSvg(
    bounds: ElementBounds,
    color: string,
    label?: string,
    svgWidth?: number,
    svgHeight?: number,
  ): string {
    const w = svgWidth ?? Math.max(bounds.x + bounds.width + 50, 1280)
    const h = svgHeight ?? Math.max(bounds.y + bounds.height + 50, 720)
    const labelSvg = label
      ? `<text x="${bounds.x + 2}" y="${bounds.y - 4}" fill="${color}" font-size="12" font-weight="bold" font-family="Arial">${escapeXml(label)}</text>`
      : ""

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" 
        fill="rgba(255,255,0,0.2)" stroke="${color}" stroke-width="2"/>
  ${labelSvg}
</svg>`
  }

  /**
   * Create SVG for numbered elements (Set-of-Marks style)
   */
  function createNumberedElementsSvg(elements: InteractiveElement[], width: number, height: number): string {
    const markers = elements
      .map((el, idx) => {
        const color = ELEMENT_COLORS[idx % ELEMENT_COLORS.length]
        const { x, y, width: w, height: h } = el.bounds
        const labelX = x + 2
        const labelY = y - 4 > 14 ? y - 4 : y + 14 // Position label above or inside

        return `
        <rect x="${x}" y="${y}" width="${w}" height="${h}" 
              fill="rgba(${hexToRgb(color)},0.15)" stroke="${color}" stroke-width="2" rx="2"/>
        <rect x="${labelX - 2}" y="${labelY - 12}" width="18" height="16" 
              fill="${color}" rx="3"/>
        <text x="${labelX + 7}" y="${labelY}" fill="white" font-size="11" font-weight="bold" 
              font-family="Arial" text-anchor="middle">${el.index}</text>
      `
      })
      .join("\n")

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${markers}
</svg>`
  }

  /**
   * Create SVG for arrow
   */
  function createArrowSvg(
    from: { x: number; y: number },
    to: { x: number; y: number },
    color: string,
    width: number,
    height: number,
  ): string {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const angle = Math.atan2(dy, dx)
    const arrowLen = 12
    const arrowAngle = Math.PI / 6

    const x1 = to.x - arrowLen * Math.cos(angle - arrowAngle)
    const y1 = to.y - arrowLen * Math.sin(angle - arrowAngle)
    const x2 = to.x - arrowLen * Math.cos(angle + arrowAngle)
    const y2 = to.y - arrowLen * Math.sin(angle + arrowAngle)

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" 
        stroke="${color}" stroke-width="3"/>
  <polygon points="${to.x},${to.y} ${x1},${y1} ${x2},${y2}" fill="${color}"/>
</svg>`
  }

  /**
   * Helper: Convert hex color to RGB values
   */
  function hexToRgb(hex: string): string {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    if (!result) return "255,255,0"
    return `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)}`
  }

  /**
   * Helper: Escape XML special characters
   */
  function escapeXml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  }

  /**
   * Get element by its numbered index from the last annotated screenshot
   */
  export function getElementByIndex(
    elementMap: Map<number, { selector: string; element: InteractiveElement }>,
    index: number,
  ): { selector: string; element: InteractiveElement } | undefined {
    return elementMap.get(index)
  }
}
