import { describe, expect, test } from "bun:test"
import { normalizePreviewBounds, normalizePreviewUrl } from "./browser-preview-policy"

describe("normalizePreviewUrl", () => {
  test("accepts loopback HTTP and HTTPS URLs on any port and path", () => {
    expect(normalizePreviewUrl("localhost:3000/app?mode=dev")).toBe("http://localhost:3000/app?mode=dev")
    expect(normalizePreviewUrl("https://127.0.0.1:8443/")).toBe("https://127.0.0.1:8443/")
    expect(normalizePreviewUrl("http://[::1]:5173/")).toBe("http://[::1]:5173/")
  })

  test("rejects non-loopback, unsupported, and credentialed URLs", () => {
    expect(() => normalizePreviewUrl("https://example.com")).toThrow("localhost")
    expect(() => normalizePreviewUrl("file:///tmp/index.html")).toThrow("HTTP")
    expect(() => normalizePreviewUrl("http://user:pass@localhost:3000")).toThrow("credentials")
    expect(() => normalizePreviewUrl("http://0.0.0.0:3000")).toThrow("localhost")
  })
})

describe("normalizePreviewBounds", () => {
  test("converts CSS coordinates using renderer zoom and clamps to the window", () => {
    expect(
      normalizePreviewBounds(
        { x: 600, y: 40, width: 500, height: 600 },
        { width: 1600, height: 1000 },
        1.25,
      ),
    ).toEqual({ x: 750, y: 50, width: 625, height: 750 })

    expect(
      normalizePreviewBounds({ x: 700, y: 500, width: 400, height: 400 }, { width: 800, height: 600 }, 1),
    ).toEqual({ x: 700, y: 500, width: 100, height: 100 })
  })

  test("rejects invalid or empty bounds", () => {
    expect(normalizePreviewBounds({ x: 0, y: 0, width: 0, height: 100 }, { width: 800, height: 600 }, 1)).toBeNull()
    expect(
      normalizePreviewBounds({ x: Number.NaN, y: 0, width: 100, height: 100 }, { width: 800, height: 600 }, 1),
    ).toBeNull()
  })
})
