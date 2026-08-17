import { afterAll, beforeAll, expect, test } from "bun:test"
import Clipboard from "@mariozechner/clipboard"
import { read, write } from "../src/clipboard"

const redPixel1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"

beforeAll(async () => {
  await Clipboard.clear().catch(() => {})
})

afterAll(async () => {
  await Clipboard.clear().catch(() => {})
})

test("write and read text round-trip", async () => {
  await write("hello clipboard")
  const result = await read()
  expect(result).toEqual({ data: "hello clipboard", mime: "text/plain" })
})

test("read returns undefined on empty clipboard", async () => {
  await Clipboard.clear()
  const result = await read()
  expect(result).toBeUndefined()
})

test("read returns image when clipboard has image", async () => {
  await Clipboard.setImageBase64(redPixel1x1)
  const result = await read()
  expect(result?.mime).toBe("image/png")
  expect(typeof result?.data).toBe("string")
  expect(result!.data.length).toBeGreaterThan(0)
})

test("read falls through to text when image read fails", async () => {
  await Clipboard.setText("fallback text")
  const result = await read()
  expect(result).toEqual({ data: "fallback text", mime: "text/plain" })
})
