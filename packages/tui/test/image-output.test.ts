import { expect, test } from "bun:test"
import { ImageRenderable, NativeImage } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { kittyImageTransport } from "../src/util/renderer"

test("uses compressed Kitty transport for a large image", async () => {
  await using app = await createTestRenderer({
    width: 100,
    height: 35,
    kittyImageTransport,
    kittyKeyboard: true,
  })

  const source = NativeImage.fromRgba(new Uint8Array(1800 * 2400 * 4).fill(255), 1800, 2400)
  const image = new ImageRenderable(app.renderer, {
    source,
    protocol: "kitty",
    width: 60,
    height: 25,
  })
  source.dispose()
  app.renderer.root.add(image)
  await image.loadPromise
  await app.renderOnce()
  await app.renderer.idle()

  expect(app.renderer.kittyImageTransportStatus.effective).toBe("zlib")
})
