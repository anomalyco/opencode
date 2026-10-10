import { expect, test } from "bun:test"
import jsQR from "jsqr"
import { renderUnicodeCompact } from "uqr"
import { renderAuthQr, renderQr } from "../src/util/qr"

const authorizationUrl = "https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH"

test("round-trips the shared renderer back to the encoded URL", () => {
  expect(renderQr(authorizationUrl, { border: 2 })).toBe(renderUnicodeCompact(authorizationUrl, { border: 2 }))
  const rendered = renderQr(authorizationUrl, { border: 4 })
  if (!rendered) throw new Error("expected a QR")
  expect(decode(modulesFromCompact(rendered))).toBe(authorizationUrl)
})

test("hides the QR unless the attempt is a device flow on a terminal", () => {
  expect(renderAuthQr(authorizationUrl, { tty: true })).toBeUndefined()
  expect(renderAuthQr(authorizationUrl, { device: true, tty: false })).toBeUndefined()
  const rendered = renderAuthQr(authorizationUrl, { device: true, tty: true })
  if (!rendered) throw new Error("expected a QR")
  expect(decode(modulesFromCompact(rendered.replace(/\x1b\[[0-9;]*m/g, "")))).toBe(authorizationUrl)
})

function decode(modules: boolean[][]) {
  const scale = 4
  const width = modules[0].length * scale
  const height = modules.length * scale
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < modules.length; y++) {
    for (let x = 0; x < modules[y].length; x++) {
      const value = modules[y][x] ? 0 : 255
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const index = ((y * scale + sy) * width + (x * scale + sx)) * 4
          pixels[index] = value
          pixels[index + 1] = value
          pixels[index + 2] = value
          pixels[index + 3] = 255
        }
      }
    }
  }
  return jsQR(pixels, width, height, { inversionAttempts: "dontInvert" })?.data
}

function modulesFromCompact(rendered: string) {
  return rendered.split("\n").flatMap((line) => {
    const top: boolean[] = []
    const bottom: boolean[] = []
    for (const glyph of line) {
      if (glyph === "█") {
        top.push(false)
        bottom.push(false)
      } else if (glyph === "▀") {
        top.push(false)
        bottom.push(true)
      } else if (glyph === "▄") {
        top.push(true)
        bottom.push(false)
      } else if (glyph === " ") {
        top.push(true)
        bottom.push(true)
      } else throw new Error(`unexpected QR glyph ${glyph}`)
    }
    return bottom.some((dark) => !dark) ? [top, bottom] : [top]
  })
}
