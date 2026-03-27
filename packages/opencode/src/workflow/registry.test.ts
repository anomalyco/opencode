import { describe, test, expect } from "bun:test"
import { REGISTRY, resolveSource } from "./registry"

describe("registry", () => {
  test("gsd alias resolves to GitHub URL", () => {
    expect(resolveSource("gsd")).toBe("https://github.com/CobuilderLabs/gsd-workflow")
  })

  test("ralph-loop alias resolves", () => {
    expect(resolveSource("ralph-loop")).toBe("https://github.com/CobuilderLabs/ralph-loop-workflow")
  })

  test("gstack alias resolves", () => {
    expect(resolveSource("gstack")).toBe("https://github.com/CobuilderLabs/gstack-workflow")
  })

  test("full https URL passes through unchanged", () => {
    const url = "https://github.com/acme/my-workflow"
    expect(resolveSource(url)).toBe(url)
  })

  test("unknown alias throws", () => {
    expect(() => resolveSource("unknown-alias")).toThrow(/Unknown workflow alias/)
  })

  test("REGISTRY contains exactly gsd, ralph-loop, gstack", () => {
    expect(Object.keys(REGISTRY).sort()).toEqual(["gsd", "gstack", "ralph-loop"])
  })
})
