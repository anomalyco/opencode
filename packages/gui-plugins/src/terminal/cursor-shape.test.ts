import { expect, test } from "bun:test"
import { createCursorShapeReader, type CursorShape } from "./cursor-shape"

const read = (chunks: readonly string[]) => {
  const shapes: CursorShape[] = []
  const reader = createCursorShapeReader((shape) => shapes.push(shape))
  const encoder = new TextEncoder()

  for (const chunk of chunks) reader(encoder.encode(chunk))

  return shapes
}

const cases: [sequence: string, shape: CursorShape][] = [
  ["\x1b[0 q", { style: "block", blink: true }],
  ["\x1b[1 q", { style: "block", blink: true }],
  ["\x1b[2 q", { style: "block", blink: false }],
  ["\x1b[3 q", { style: "underline", blink: true }],
  ["\x1b[4 q", { style: "underline", blink: false }],
  ["\x1b[5 q", { style: "bar", blink: true }],
  ["\x1b[6 q", { style: "bar", blink: false }],
  ["\x1b[ q", { style: "block", blink: true }],
]

test.each(cases)("reads DECSCUSR %j", (sequence, shape) => {
  expect(read([sequence])).toEqual([shape])
})

test("reads a sequence split across chunks", () => {
  expect(read(["\x1b[2", " ", "q"])).toEqual([{ style: "block", blink: false }])
})

test("uses the last of several sequences", () => {
  expect(read(["\x1b[2 qhello\x1b[5 q"]).at(-1)).toEqual({ style: "bar", blink: true })
})

test("ignores other CSI sequences and incomplete input", () => {
  expect(read(["\x1b[31m\x1b[?25l\x1b[2 q\x1b[4"])).toEqual([{ style: "block", blink: false }])
})

test("ignores an unknown shape", () => {
  expect(read(["\x1b[7 q"])).toEqual([])
})
