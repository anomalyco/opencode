import { expect, test } from "bun:test"
import jsQR from "jsqr"
import { renderUnicodeCompact } from "@opencode/util/qr"
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
  // jsqr is CommonJS; under some resolvers the function is on `default`.
  const reader = typeof jsQR === "function" ? jsQR : (jsQR as { default: typeof jsQR }).default
  return reader(pixels, width, height, { inversionAttempts: "dontInvert" })?.data
}

// Matches @opencode/util/qr renderUnicodeCompact: filled glyphs are light modules, spaces are dark.
function modulesFromCompact(rendered: string) {
  const halves: Record<string, [boolean, boolean]> = {
    "\u2588": [false, false],
    "\u2580": [false, true],
    "\u2584": [true, false],
    " ": [true, true],
  }
  const lines = rendered.split("\n")
  return lines
    .flatMap((line) => {
      const pairs = [...line].map((char) => {
        const pair = halves[char]
        if (!pair) throw new Error(`unexpected QR glyph ${char}`)
        return pair
      })
      return [pairs.map((pair) => pair[0]), pairs.map((pair) => pair[1])]
    })
    .slice(0, lines[0].length)
}
