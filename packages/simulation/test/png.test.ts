import { expect, test } from "bun:test"
import { RGBA, TextAttributes, type CapturedFrame } from "@opentui/core"
import { SimulationPng } from "../src/frontend/png"

test("renders captured frames with bundled fonts", () => {
  const frame: CapturedFrame = {
    cols: 4,
    rows: 1,
    cursor: [0, 0],
    lines: [
      {
        spans: [
          {
            text: "Test",
            width: 4,
            fg: RGBA.fromInts(255, 255, 255),
            bg: RGBA.fromInts(0, 0, 0),
            attributes: TextAttributes.BOLD | TextAttributes.ITALIC,
          },
        ],
      },
    ],
  }

  const image = SimulationPng.screenshotFrame(frame)
  expect(image.width).toBe(40)
  expect(image.height).toBe(20)
  expect(image.data.subarray(1, 4).toString()).toBe("PNG")
})
