import { expect, test } from "bun:test"
import path from "node:path"
import { signalIncludesServer, snapshotDirectory } from "./signal"

test.each([
  [undefined, false],
  ["relative", false],
  ["", false],
  [path.resolve("heaps"), true],
] as const)("signal snapshots require an absolute destination (%s)", (directory, enabled) => {
  expect(snapshotDirectory({ OPENCODE_DESKTOP_HEAP_DIRECTORY: directory })).toBe(enabled ? directory : undefined)
})

test.each([undefined, "", "0", "true", "1"])("signal server snapshots require the explicit 1 opt-in (%s)", (value) => {
  expect(signalIncludesServer({ OPENCODE_DESKTOP_HEAP_INCLUDE_SERVER: value })).toBe(value === "1")
})
