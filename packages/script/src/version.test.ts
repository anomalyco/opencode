import { describe, expect, test } from "bun:test"
import { previewVersion, sanitizeChannel, sanitizePreviewVersion } from "./version"

describe("sanitizeChannel", () => {
  test("replaces slash separators", () => {
    expect(sanitizeChannel("opencode/jolly-river")).toBe("opencode-jolly-river")
  })

  test("falls back when channel is empty", () => {
    expect(sanitizeChannel("///")).toBe("preview")
  })
})

describe("sanitizePreviewVersion", () => {
  test("sanitizes preview prerelease labels", () => {
    expect(sanitizePreviewVersion("0.0.0-opencode/jolly-river-20260304")).toBe("0.0.0-opencode-jolly-river-20260304")
  })

  test("leaves stable versions untouched", () => {
    expect(sanitizePreviewVersion("1.2.3")).toBe("1.2.3")
  })
})

describe("previewVersion", () => {
  test("builds semver-safe preview versions", () => {
    const date = new Date("2026-03-04T22:56:02.000Z")
    expect(previewVersion("opencode/jolly-river", date)).toBe("0.0.0-opencode-jolly-river-202603042256")
  })
})
