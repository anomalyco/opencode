import { expect, test } from "bun:test"
import { createCanvas, loadImage } from "@napi-rs/canvas"
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

test("fills adjacent block elements without glyph gaps", async () => {
  const image = SimulationPng.screenshotFrame({
    cols: 2,
    rows: 1,
    cursor: [0, 0],
    lines: [
      {
        spans: [
          {
            text: "▀▀",
            width: 2,
            fg: RGBA.fromInts(255, 255, 255),
            bg: RGBA.fromInts(0, 0, 0),
            attributes: 0,
          },
        ],
      },
    ],
  })
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext("2d")
  context.drawImage(await loadImage(image.data), 0, 0)

  expect([...context.getImageData(0, 5, image.width, 1).data]).toEqual(
    Array.from({ length: image.width }, () => [255, 255, 255, 255]).flat(),
  )
  expect([...context.getImageData(0, 15, image.width, 1).data]).toEqual(
    Array.from({ length: image.width }, () => [0, 0, 0, 255]).flat(),
  )
})

test("draws heavy vertical box elements on cell boundaries", async () => {
  const image = SimulationPng.screenshotFrame({
    cols: 1,
    rows: 2,
    cursor: [0, 0],
    lines: [
      {
        spans: [
          {
            text: "┃",
            width: 1,
            fg: RGBA.fromInts(255, 255, 255),
            bg: RGBA.fromInts(0, 0, 0),
            attributes: 0,
          },
        ],
      },
      {
        spans: [
          {
            text: "╹",
            width: 1,
            fg: RGBA.fromInts(255, 255, 255),
            bg: RGBA.fromInts(0, 0, 0),
            attributes: 0,
          },
        ],
      },
    ],
  })
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext("2d")
  context.drawImage(await loadImage(image.data), 0, 0)

  expect([...context.getImageData(4, 0, 2, 30).data]).toEqual(
    Array.from({ length: 60 }, () => [255, 255, 255, 255]).flat(),
  )
  expect([...context.getImageData(4, 30, 2, 10).data]).toEqual(
    Array.from({ length: 20 }, () => [0, 0, 0, 255]).flat(),
  )
})
