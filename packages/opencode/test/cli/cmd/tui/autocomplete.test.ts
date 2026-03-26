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
    expect(ended("dir with space/")).toBe(false)
    expect(ended("dir with space/file.ts")).toBe(false)
  })

  test("allows editing a spaced path after tab completion", async () => {
    const { ended } = await load()
    expect(ended("dir with space")).toBe(false)
    expect(ended("dir with spce/")).toBe(false)
  })

  test("ends when a delimiter space is typed at the end", async () => {
    const { ended } = await load()
    expect(ended("dir with space/ ")).toBe(true)
    expect(ended("foobar ")).toBe(true)
  })
})
