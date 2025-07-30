import sharp from "sharp"

const MAX_WIDTH = 2000
const MAX_HEIGHT = 2000
const MAX_SIZE_BYTES = 5 * 1024 * 1024 // 5MB
const JPEG_QUALITY = 85

export namespace ImageProcessor {
  export async function process(buffer: ArrayBuffer): Promise<Buffer> {
    const input = Buffer.from(buffer)
    
    // Get metadata to check dimensions
    const metadata = await sharp(input).metadata()
    
    // Start with the original image
    let pipeline = sharp(input)
    
    // Resize if dimensions exceed limits
    if (metadata.width && metadata.height) {
      if (metadata.width > MAX_WIDTH || metadata.height > MAX_HEIGHT) {
        pipeline = pipeline.resize(MAX_WIDTH, MAX_HEIGHT, {
          fit: 'inside',
          withoutEnlargement: true
        })
      }
    }
    
    // Convert to JPEG for compression if not already
    if (metadata.format !== 'jpeg') {
      pipeline = pipeline.jpeg({ quality: JPEG_QUALITY })
    }
    
    // Process the image
    let output = await pipeline.toBuffer()
    
    // If still too large, reduce quality further
    if (output.length > MAX_SIZE_BYTES) {
      let quality = JPEG_QUALITY
      while (output.length > MAX_SIZE_BYTES && quality > 20) {
        quality -= 10
        output = await sharp(input)
          .resize(MAX_WIDTH, MAX_HEIGHT, {
            fit: 'inside',
            withoutEnlargement: true
          })
          .jpeg({ quality })
          .toBuffer()
      }
    }
    
    return output
  }
  
  export function getMimeType(buffer: Buffer): string {
    // Check magic numbers for common image formats
    const header = buffer.subarray(0, 12).toString('hex')
    
    if (header.startsWith('ffd8ff')) return 'image/jpeg'
    if (header.startsWith('89504e47')) return 'image/png'
    if (header.startsWith('47494638')) return 'image/gif'
    if (header.startsWith('424d')) return 'image/bmp'
    if (header.includes('3c737667')) return 'image/svg+xml'
    if (header.startsWith('52494646') && header.slice(16, 24) === '57454250') return 'image/webp'
    
    // Default to JPEG if processed
    return 'image/jpeg'
  }
}