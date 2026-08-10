import { describe, expect, test } from "bun:test"
import { formatBytes, formatCount } from "./storage-format"

describe("storage formatting", () => {
  test("formats byte magnitudes without overstating precision", () => {
    expect(formatBytes(0, "en-US")).toBe("0 B")
    expect(formatBytes(1536, "en-US")).toBe("1.5 KiB")
    expect(formatBytes(12 * 1024 * 1024, "en-US")).toBe("12 MiB")
    expect(formatBytes(Number.NaN, "en-US")).toBe("0 B")
  })

  test("formats event counts for the active locale", () => {
    expect(formatCount(12_345, "en-US")).toBe("12,345")
  })
})
