import { afterEach, expect, test } from "bun:test"
import { ringBell, screenReader } from "../../src/mini/screen-reader"

const bell = screenReader.bell

afterEach(() => {
  screenReader.enabled = false
  screenReader.bell = bell
})

test("rings only in screen reader mode", () => {
  let rings = 0
  screenReader.bell = () => rings++
  ringBell()
  screenReader.enabled = true
  ringBell()
  expect(rings).toBe(1)
})
