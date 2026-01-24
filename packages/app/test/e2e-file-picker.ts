/**
 * E2E test for file picker image attachment
 */

import { chromium } from "playwright"

async function test() {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()

  // Enable console logging to see what's happening
  page.on("console", (msg) => {
    console.log(`[BROWSER ${msg.type()}]:`, msg.text())
  })

  console.log("Navigating to OpenCode...")
  await page.goto("http://localhost:5050")
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(2000)

  // Find the file input
  const fileInput = page.locator('input[type="file"]')
  const exists = await fileInput.count()
  console.log(`File input found: ${exists > 0}`)

  if (exists === 0) {
    console.error("No file input found!")
    await browser.close()
    return
  }

  // Check accepted types
  const accept = await fileInput.getAttribute("accept")
  console.log(`Accepted types: ${accept}`)

  // Create a simple test PNG image
  const pngBuffer = createSimplePNG()

  // Use setInputFiles to upload via file picker
  console.log("Setting file via file picker...")
  await fileInput.setInputFiles({
    name: "test-image.png",
    mimeType: "image/png",
    buffer: pngBuffer,
  })

  await page.waitForTimeout(1000)

  // Check if image preview appeared
  const imagePreview = page.locator('img[alt="test-image.png"]')
  const previewExists = await imagePreview.count()
  console.log(`Image preview appeared: ${previewExists > 0}`)

  // Also check for any image in the attachments area
  const anyImage = page.locator(".relative.group img")
  const anyImageExists = await anyImage.count()
  console.log(`Any attachment image: ${anyImageExists > 0}`)

  // Check if imageAttachments div is visible
  const attachmentsArea = page.locator(".flex.flex-wrap.gap-2.px-3.pt-3")
  const attachmentsVisible = await attachmentsArea.count()
  console.log(`Attachments area visible: ${attachmentsVisible > 0}`)

  // Take a screenshot for debugging
  await page.screenshot({ path: "test-results/file-picker-test.png" })
  console.log("Screenshot saved to test-results/file-picker-test.png")

  await page.waitForTimeout(3000)
  await browser.close()
}

function createSimplePNG(): Buffer {
  // Minimal valid PNG: 8x8 red square
  const width = 8
  const height = 8

  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  // IHDR chunk
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0) // length
  ihdr.write("IHDR", 4)
  ihdr.writeUInt32BE(width, 8)
  ihdr.writeUInt32BE(height, 12)
  ihdr.writeUInt8(8, 16) // bit depth
  ihdr.writeUInt8(2, 17) // color type (RGB)
  ihdr.writeUInt8(0, 18) // compression
  ihdr.writeUInt8(0, 19) // filter
  ihdr.writeUInt8(0, 20) // interlace

  const ihdrCrc = crc32(ihdr.subarray(4, 21))
  ihdr.writeUInt32BE(ihdrCrc, 21)

  // IDAT chunk (raw image data with zlib)
  const rawData: number[] = []
  for (let y = 0; y < height; y++) {
    rawData.push(0) // filter byte
    for (let x = 0; x < width; x++) {
      rawData.push(255, 0, 0) // RGB red
    }
  }

  const { deflateSync } = require("zlib")
  const compressed = deflateSync(Buffer.from(rawData))

  const idat = Buffer.alloc(compressed.length + 12)
  idat.writeUInt32BE(compressed.length, 0)
  idat.write("IDAT", 4)
  compressed.copy(idat, 8)
  const idatCrc = crc32(Buffer.concat([Buffer.from("IDAT"), compressed]))
  idat.writeUInt32BE(idatCrc, idat.length - 4)

  // IEND chunk
  const iend = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])

  return Buffer.concat([signature, ihdr, idat, iend])
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  const table = makeCrcTable()
  for (const byte of data) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makeCrcTable(): number[] {
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
}

test().catch(console.error)
