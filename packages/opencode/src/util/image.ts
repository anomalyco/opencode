import sharp from 'sharp'

// Anthropic limit is 5MB base64; base64 inflates ~4/3x, so cap raw bytes at 3.75MB
const DEFAULT_MAX_BYTES = 3.75 * 1024 * 1024
const DEFAULT_QUALITY = 85
const MAX_DIMENSION = 2048

export namespace Image {
  export interface CompressOptions {
    data: string
    mime: string
    maxBytes?: number
    quality?: number
    allowFormatChange?: boolean
  }

  export interface CompressResult {
    data: string
    mime: string
    compressed: boolean
    originalSize: number
    finalSize: number
  }

  export interface ImageInfo {
    width: number
    height: number
    format: string
    hasAlpha: boolean
  }

  export interface ResizeOptions {
    data: string
    maxWidth: number
    maxHeight: number
  }

  export interface ResizeResult {
    data: string
    width: number
    height: number
  }

  export interface OptimizeOptions {
    data: string
    mime: string
    targetBytes?: number
  }

  export function needsCompression(base64: string, thresholdBytes = DEFAULT_MAX_BYTES): boolean {
    const sizeBytes = Math.ceil((base64.length * 3) / 4)
    return sizeBytes > thresholdBytes
  }

  export async function getInfo(base64: string): Promise<ImageInfo> {
    const buffer = Buffer.from(base64, 'base64')
    const metadata = await sharp(buffer).metadata()

    return {
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      format: metadata.format ?? 'unknown',
      hasAlpha: metadata.hasAlpha ?? false
    }
  }

  export async function resize(options: ResizeOptions): Promise<ResizeResult> {
    const buffer = Buffer.from(options.data, 'base64')
    const metadata = await sharp(buffer).metadata()

    const currentWidth = metadata.width ?? 0
    const currentHeight = metadata.height ?? 0

    if (currentWidth <= options.maxWidth && currentHeight <= options.maxHeight) {
      return {
        data: options.data,
        width: currentWidth,
        height: currentHeight
      }
    }

    const resized = await sharp(buffer)
      .resize(options.maxWidth, options.maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .toBuffer()

    const newMetadata = await sharp(resized).metadata()

    return {
      data: resized.toString('base64'),
      width: newMetadata.width ?? 0,
      height: newMetadata.height ?? 0
    }
  }

  export function estimateCompressedSize(originalSize: number, format: 'jpeg' | 'webp' | 'png', quality: number): number {
    const qualityFactor = quality / 100
    switch (format) {
      case 'jpeg':
        return Math.ceil(originalSize * qualityFactor * 0.3)
      case 'webp':
        return Math.ceil(originalSize * qualityFactor * 0.25)
      case 'png':
        return Math.ceil(originalSize * 0.7)
    }
  }

  export async function compress(options: CompressOptions): Promise<CompressResult> {
    if (!options.data) {
      throw new Error('Image data is required')
    }

    const buffer = Buffer.from(options.data, 'base64')
    const originalSize = buffer.length
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    const quality = options.quality ?? DEFAULT_QUALITY

    if (originalSize <= maxBytes) {
      return {
        data: options.data,
        mime: options.mime,
        compressed: false,
        originalSize,
        finalSize: originalSize
      }
    }

    const metadata = await sharp(buffer).metadata()
    const hasAlpha = metadata.hasAlpha ?? false
    const currentWidth = metadata.width ?? 0
    const currentHeight = metadata.height ?? 0

    let pipeline = sharp(buffer)

    if (currentWidth > MAX_DIMENSION || currentHeight > MAX_DIMENSION) {
      pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true
      })
    }

    let outputFormat: 'jpeg' | 'webp' | 'png' = 'jpeg'
    let outputMime = 'image/jpeg'

    if (hasAlpha) {
      outputFormat = 'webp'
      outputMime = 'image/webp'
    } else if (options.allowFormatChange !== false) {
      outputFormat = 'jpeg'
      outputMime = 'image/jpeg'
    } else {
      outputFormat = 'webp'
      outputMime = 'image/webp'
    }

    let currentQuality = quality
    let result: Buffer
    let currentMaxDimension = MAX_DIMENSION

    // Phase 1: Try quality reduction at current dimensions
    while (currentQuality >= 20) {
      if (outputFormat === 'jpeg') {
        result = await pipeline.clone().jpeg({ quality: currentQuality, mozjpeg: true }).toBuffer()
      } else if (outputFormat === 'webp') {
        result = await pipeline.clone().webp({ quality: currentQuality }).toBuffer()
      } else {
        result = await pipeline.clone().png({ compressionLevel: 9 }).toBuffer()
      }

      if (result.length <= maxBytes) {
        return {
          data: result.toString('base64'),
          mime: outputMime,
          compressed: true,
          originalSize,
          finalSize: result.length
        }
      }

      currentQuality -= 10
    }

    // Phase 2: Progressive dimension reduction with low quality
    while (currentMaxDimension >= 512) {
      pipeline = sharp(buffer).resize(currentMaxDimension, currentMaxDimension, {
        fit: 'inside',
        withoutEnlargement: true
      })

      result = await pipeline.clone().webp({ quality: 30 }).toBuffer()

      if (result.length <= maxBytes) {
        return {
          data: result.toString('base64'),
          mime: 'image/webp',
          compressed: true,
          originalSize,
          finalSize: result.length
        }
      }

      currentMaxDimension = Math.floor(currentMaxDimension * 0.75)
    }

    // Phase 3: Final fallback — small dimensions, lowest quality
    result = await sharp(buffer).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 20 }).toBuffer()

    return {
      data: result.toString('base64'),
      mime: 'image/webp',
      compressed: true,
      originalSize,
      finalSize: result.length
    }
  }

  export async function optimizeForUpload(options: OptimizeOptions): Promise<CompressResult> {
    const targetBytes = options.targetBytes ?? DEFAULT_MAX_BYTES

    return compress({
      data: options.data,
      mime: options.mime,
      maxBytes: targetBytes,
      allowFormatChange: true
    })
  }
}
