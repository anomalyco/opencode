import { describe, expect, test } from "bun:test"
import { previewablePath } from "./markdown"

describe("previewablePath", () => {
  test("keeps relative file links previewable", () => {
    expect(previewablePath("src/app.ts")).toBe("src/app.ts")
  })

  test("supports absolute file links with line suffix", () => {
    expect(previewablePath("/repo/src/app.ts:12")).toBe("/repo/src/app.ts?start=12&end=12")
  })

  test("supports filename-only paths without dot when explicitly allowed", () => {
    expect(previewablePath("Dockerfile")).toBe("Dockerfile")
  })

  test("ignores web urls", () => {
    expect(previewablePath("https://example.com/app.ts")).toBeUndefined()
  })

  test("supports windows absolute file links", () => {
    expect(previewablePath("C:/repo/src/app.ts:7")).toBe("C:/repo/src/app.ts?start=7&end=7")
  })
})
