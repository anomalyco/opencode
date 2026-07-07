import { inflateSync } from "node:zlib"
import { RGBA } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { expect, test } from "bun:test"
import { SimulationPng } from "../src/frontend/png"

test("renders an OpenTUI buffer as PNG", async () => {
  const setup = await createTestRenderer({ width: 4, height: 2 })
  setup.renderer.currentRenderBuffer.setCell(0, 0, "A", RGBA.fromInts(255, 255, 255), RGBA.fromInts(0, 0, 0))

  const image = SimulationPng.screenshot(setup.renderer)
  const png = Buffer.from(image.data, "base64")
  const idatLength = png.readUInt32BE(33)

  expect(image).toMatchObject({ mime: "image/png", width: 32, height: 32 })
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(inflateSync(png.subarray(41, 41 + idatLength))).toHaveLength((image.width * 4 + 1) * image.height)

  setup.renderer.destroy()
})
