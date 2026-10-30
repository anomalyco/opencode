import { expect, test } from "bun:test"
import { ImageRenderable, NativeImage, TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Writable } from "node:stream"
import { inflateSync } from "node:zlib"
import { kittyImageTransport } from "../src/util/renderer"

test.each([
  { width: 390, height: 844, resolution: "unknown" },
  { width: 1800, height: 2400, resolution: "unknown" },
  { width: 1800, height: 2400, resolution: "known" },
])("emits a $width x $height Kitty image with $resolution pixel dimensions", async ({ width, height, resolution }) => {
  const output: Buffer[] = []
  await using app = await createTestRenderer({
    width: 100,
    height: 35,
    bufferedOutput: "stdout",
    kittyImageTransport,
    kittyKeyboard: true,
    stdout: new Writable({
      write(chunk, _encoding, callback) {
        output.push(Buffer.from(chunk))
        callback()
      },
    }) as NodeJS.WriteStream,
  })
  if (resolution === "known") {
    await app.renderer.setupTerminal()
    app.renderer.stdin.emit("data", Buffer.from("\x1b[4;2100;1600t"))
  }
  const label = new TextRenderable(app.renderer, { content: "Image preview", height: 1 })
  app.renderer.root.add(label)
  await app.renderOnce()
  await app.renderer.idle()
  expect(app.renderer.resolution).toEqual(resolution === "known" ? { width: 1600, height: 2100 } : null)
  output.length = 0

  // Decoded JPEGs have no PNG payload, so raw transport expands to base64 RGB/RGBA.
  const source = NativeImage.fromRgba(new Uint8Array(width * height * 4).fill(255), width, height)
  const image = new ImageRenderable(app.renderer, {
    source,
    protocol: "kitty",
    position: "absolute",
    width: 60,
    height: 25,
    zIndex: 4000,
  })
  source.dispose()
  app.renderer.root.add(image)
  await image.loadPromise
  await app.renderOnce()
  await app.renderer.idle()

  const transmission = Buffer.concat(output).toString()
  expect(transmission.slice(0, 500)).toMatch(/\x1b_Ga=t,f=(24|32),[^;]*o=z/)
  expect(app.renderer.kittyImageTransportStatus.effective).toBe("zlib")
  const payload = [...transmission.matchAll(/\x1b_G[^;]*;([^\x1b]*)\x1b\\/g)].flatMap((match) =>
    match[1] ? [Buffer.from(match[1], "base64")] : [],
  )
  const pixels = inflateSync(Buffer.concat(payload))
  expect(pixels.byteLength).toBe(width * height * 3)
  expect(pixels.every((value) => value === 255)).toBe(true)
  output.length = 0
  image.destroy()
  await app.renderOnce()
  await app.renderer.idle()
  expect(Buffer.concat(output).toString()).toContain("\x1b_Ga=d")
})
