import { stat } from "node:fs/promises"
import { RGBA } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { expect, test } from "bun:test"
import { SimulationActions } from "../src/frontend/actions"

test("encodes captured OpenTUI frames as video", async () => {
  const setup = await createTestRenderer({ width: 4, height: 2 })
  const harness = SimulationActions.createHarness(setup.renderer)
  setup.renderer.currentRenderBuffer.setCell(0, 0, "A", RGBA.fromInts(255, 255, 255), RGBA.fromInts(0, 0, 0))
  const first = SimulationActions.frame(harness)
  setup.renderer.currentRenderBuffer.setCell(1, 0, "B", RGBA.fromInts(255, 255, 255), RGBA.fromInts(0, 0, 0))

  const path = await SimulationActions.video([first, SimulationActions.frame(harness)])

  expect(path.endsWith("/recording.mp4")).toBe(true)
  expect((await stat(path)).size).toBeGreaterThan(0)
  setup.renderer.destroy()
})
