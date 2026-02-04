import { Jimp } from "jimp"
import { Log } from "./log"
import { appendFileSync } from "fs"

const log = Log.create({ service: "image" })
const DEBUG_LOG = "/tmp/opencode-image-debug.log"

function dbg(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try {
    appendFileSync(DEBUG_LOG, line)
  } catch {}
}

// Anthropic rejects images >2000px per dimension in many-image requests
const MAX_DIMENSION = 2000
const MAX_BUFFER = 3_932_160
const API_LIMIT = 5_242_880

export async function processImage(buffer: Buffer, mime: string): Promise<{ data: string; mime: string }> {
  dbg(`processImage called: mime=${mime} bufLen=${buffer.length}`)

  try {
    const img = await Jimp.fromBuffer(buffer)
    const w = img.width
    const h = img.height
    dbg(`processImage: dimensions=${w}x${h} bufLen=${buffer.length}`)

    if (buffer.length <= MAX_BUFFER && w <= MAX_DIMENSION && h <= MAX_DIMENSION) {
      dbg(`processImage: within limits, passthrough`)
      return { data: buffer.toString("base64"), mime }
    }

    let tw = w
    let th = h
    if (tw > MAX_DIMENSION) {
      th = Math.round((th * MAX_DIMENSION) / tw)
      tw = MAX_DIMENSION
    }
    if (th > MAX_DIMENSION) {
      tw = Math.round((tw * MAX_DIMENSION) / th)
      th = MAX_DIMENSION
    }

    const needsResize = tw !== w || th !== h

    // If only file size is too large (no dimension issue), try compression
    if (!needsResize && buffer.length > MAX_BUFFER) {
      for (const q of [80, 60, 40, 20]) {
        const compressed = await img.getBuffer("image/jpeg", { quality: q })
        dbg(`processImage: jpeg q=${q} → ${compressed.length}`)
        if (compressed.length <= MAX_BUFFER)
          return { data: Buffer.from(compressed).toString("base64"), mime: "image/jpeg" }
      }
    }

    if (needsResize) {
      dbg(`processImage: resizing ${w}x${h} → ${tw}x${th}`)
      log.info("resizing image", { from: `${w}x${h}`, to: `${tw}x${th}` })
      img.scaleToFit({ w: tw, h: th })
    }

    // Try original format first
    const resized = await img.getBuffer("image/jpeg", { quality: 85 })
    dbg(`processImage: resized → ${resized.length} bytes`)
    if (resized.length <= MAX_BUFFER) return { data: Buffer.from(resized).toString("base64"), mime: "image/jpeg" }

    // Progressive quality reduction
    for (const q of [80, 60, 40, 20]) {
      const compressed = await img.getBuffer("image/jpeg", { quality: q })
      dbg(`processImage: jpeg q=${q} → ${compressed.length}`)
      if (compressed.length <= MAX_BUFFER)
        return { data: Buffer.from(compressed).toString("base64"), mime: "image/jpeg" }
    }

    // Aggressive downscale as last resort
    const sw = Math.min(tw, 1000)
    const sh = Math.round((th * sw) / Math.max(tw, 1))
    dbg(`processImage: aggressive downscale → ${sw}x${sh}`)
    log.info("aggressive downscale", { to: `${sw}x${sh}` })
    img.scaleToFit({ w: sw, h: sh })
    const tiny = await img.getBuffer("image/jpeg", { quality: 20 })
    dbg(`processImage: tiny → ${tiny.length} bytes`)
    return { data: Buffer.from(tiny).toString("base64"), mime: "image/jpeg" }
  } catch (err) {
    dbg(`processImage: ERROR: ${err}`)
    log.warn("image processing failed, sending raw", { error: err })
    if (buffer.length <= API_LIMIT) return { data: buffer.toString("base64"), mime }
    throw new Error(
      `Unable to process image (${(buffer.length / 1048576).toFixed(1)} MB). The image exceeds the 5MB API limit and processing failed. Please use a smaller image.`,
    )
  }
}
