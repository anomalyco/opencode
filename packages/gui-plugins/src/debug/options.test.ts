import { expect, test } from "bun:test"
import { debugBuild, memoryLogInterval } from "./options"

test.each([
  [{ packaged: false, channel: "dev" }, true],
  [{ packaged: false, channel: "prod" }, true],
  [{ packaged: true, channel: "beta" }, true],
  [{ packaged: true, channel: "dev" }, false],
  [{ packaged: true, channel: "prod" }, false],
] as const)("%o is a debug build: %s", (build, expected) => {
  expect(debugBuild(build)).toBe(expected)
})

test.each([
  [undefined, undefined],
  ["", undefined],
  ["0", undefined],
  ["-1", undefined],
  ["NaN", undefined],
  ["Infinity", undefined],
  ["0.5", undefined],
  ["2147484", undefined],
  ["1", 1000],
  ["2.5", 2500],
  ["60", 60000],
] as const)("memory interval %s is bounded", (value, expected) => {
  expect(memoryLogInterval(value)).toBe(expected)
})
