import { RGBA } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { expect, test } from "bun:test"
import { SimulationPng } from "../src/frontend/png"

test("renders an OpenTUI buffer as PNG", async () => {
  const setup = await createTestRenderer({ width: 4, height: 2 })
  setup.renderer.currentRenderBuffer.setCell(0, 0, "A", RGBA.fromInts(255, 255, 255), RGBA.fromInts(0, 0, 0))

  const image = SimulationPng.screenshot(setup.renderer)
  const png = image.data

  expect(image).toMatchObject({ width: 40, height: 40 })
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([image.width, image.height])

  setup.renderer.destroy()
})
