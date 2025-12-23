import { Transformer, ResizeFilterType, JsColorType, losslessCompressPng } from "@napi-rs/image"

const ALPHA_COLOR_TYPES = [
  JsColorType.La8,
  JsColorType.Rgba8,
  JsColorType.La16,
  JsColorType.Rgba16,
  JsColorType.Rgba32F,
]

export namespace ImageOptimizer {
  export const SIZE_LIMIT = 5 * 1024 * 1024 // 5MB

  export interface OptimizationResult {
    data: string // base64 encoded
    mime: string // "image/png" or "image/jpeg"
  }

  export function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB"
    if (bytes >= 1024) return (bytes / 1024).toFixed(2) + " KB"
    return bytes + " B"
  }

  export function needsOptimization(size: number): boolean {
    return size > SIZE_LIMIT
  }

  /**
   * Optimize image to fit under 5MB
   * - Preserves PNG for transparent images (with lossless compression)
   * - Converts to JPEG for opaque images
   * - Reduces dimensions first (bigger savings), then quality for JPEG
   */
  export async function optimize(input: Buffer): Promise<OptimizationResult> {
    const buffer = input
    const metadata = await new Transformer(buffer).metadata()
    const hasAlpha = ALPHA_COLOR_TYPES.includes(metadata.colorType)

    let width = metadata.width
    let height = metadata.height
    let quality = 85
    let triedLowerQuality = false
    let result: Buffer = buffer

    // Iterative optimization: reduce dimensions first, then quality (JPEG only)
    while (true) {
      const img = new Transformer(buffer)

      // Resize from original if dimensions changed (avoids cascading quality loss)
      if (width !== metadata.width || height !== metadata.height) {
        img.resize(width, height, ResizeFilterType.Lanczos3)
      }

      // PNG for transparency, JPEG for opaque
      if (hasAlpha) {
        const pngBuffer = await img.png()
        result = await losslessCompressPng(pngBuffer)
      } else {
        result = await img.jpeg(quality)
      }

      if (result.length <= SIZE_LIMIT) break

      // Safety: minimum dimensions reached
      if (width < 100 || height < 100) break

      // First pass at original dimensions - try reducing size
      if (width === metadata.width && height === metadata.height) {
        width = Math.floor(width * 0.8)
        height = Math.floor(height * 0.8)
        continue
      }

      // JPEG: try quality reduction once before more dimension reduction
      if (!hasAlpha && !triedLowerQuality && quality > 75) {
        quality = 75
        triedLowerQuality = true
        continue
      }

      // Further dimension reduction needed
      width = Math.floor(width * 0.8)
      height = Math.floor(height * 0.8)
      if (!hasAlpha) {
        quality = 85
        triedLowerQuality = false
      }
    }

    return {
      data: result.toString("base64"),
      mime: hasAlpha ? "image/png" : "image/jpeg",
    }
  }
}
