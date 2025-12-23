import { Transformer, ResizeFilterType, JsColorType, losslessCompressPng } from "@napi-rs/image"

const ALPHA_COLOR_TYPES = new Set([
  JsColorType.La8,
  JsColorType.Rgba8,
  JsColorType.La16,
  JsColorType.Rgba16,
  JsColorType.Rgba32F,
])

async function encodeImage(img: Transformer, hasAlpha: boolean, quality: number): Promise<Buffer> {
  if (hasAlpha) {
    const pngBuffer = await img.png()
    return losslessCompressPng(pngBuffer)
  }
  return img.jpeg(quality)
}

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
    const metadata = await new Transformer(input).metadata()
    const hasAlpha = ALPHA_COLOR_TYPES.has(metadata.colorType)
    const state = { width: metadata.width, height: metadata.height, quality: 85, triedLowerQuality: false }

    // Iterative optimization: reduce dimensions first, then quality (JPEG only)
    for (;;) {
      const img = new Transformer(input)

      // Resize from original if dimensions changed (avoids cascading quality loss)
      if (state.width !== metadata.width || state.height !== metadata.height) {
        img.resize(state.width, state.height, ResizeFilterType.Lanczos3)
      }

      const result = await encodeImage(img, hasAlpha, state.quality)

      if (result.length <= SIZE_LIMIT || state.width < 100 || state.height < 100) {
        return {
          data: result.toString("base64"),
          mime: hasAlpha ? "image/png" : "image/jpeg",
        }
      }

      // First pass at original dimensions - try reducing size
      if (state.width === metadata.width && state.height === metadata.height) {
        state.width = Math.floor(state.width * 0.8)
        state.height = Math.floor(state.height * 0.8)
        continue
      }

      // JPEG: try quality reduction once before more dimension reduction
      if (!hasAlpha && !state.triedLowerQuality && state.quality > 75) {
        state.quality = 75
        state.triedLowerQuality = true
        continue
      }

      // Further dimension reduction needed
      state.width = Math.floor(state.width * 0.8)
      state.height = Math.floor(state.height * 0.8)
      if (!hasAlpha) {
        state.quality = 85
        state.triedLowerQuality = false
      }
    }
  }
}
