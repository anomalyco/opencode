import { describe, expect, mock, test } from "bun:test"

mock.module("@opentui/solid/jsx-runtime", () => ({
  Fragment: Symbol("Fragment"),
  jsx: () => null,
  jsxs: () => null,
  jsxDEV: () => null,
}))

async function load() {
  return import("../../../../src/cli/cmd/tui/component/prompt/autocomplete")
}

describe("autocomplete", () => {
  test("allows spaces inside an accepted path prefix", async () => {
    const { ended } = await load()
    expect(ended("dir with space/", "dir with space/")).toBe(false)
    expect(ended("dir with space/file.ts", "dir with space/")).toBe(false)
  })

  test("ends once whitespace appears after an accepted path prefix", async () => {
    const { ended } = await load()
    expect(ended("dir with space/ note", "dir with space/")).toBe(true)
  })

  test("ends when the query no longer matches the accepted prefix", async () => {
    const { ended } = await load()
    expect(ended("dir with space", "dir with space/")).toBe(true)
  })
})
