import { describe, expect, it } from "bun:test"
import { inScopes, isAllowedOrigin, matchScope, normalizeBridgePath } from "./webview-bridge"

describe("normalizeBridgePath", () => {
  it("normalizes relative paths", () => {
    expect(normalizeBridgePath("/repo", "./tasks/T-001.md")).toBe("tasks/T-001.md")
  })

  it("blocks escaping paths", () => {
    expect(normalizeBridgePath("/repo", "../etc/passwd")).toBeUndefined()
  })

  it("accepts absolute path inside workspace", () => {
    expect(normalizeBridgePath("/repo", "/repo/TASKS.md")).toBe("TASKS.md")
  })
})

describe("scope matching", () => {
  it("matches simple wildcard", () => {
    expect(matchScope("tasks/T-001.md", "tasks/*.md")).toBe(true)
  })

  it("matches deep wildcard", () => {
    expect(matchScope("tasks/epic/T-001.md", "tasks/**/*.md")).toBe(true)
  })

  it("checks allow list", () => {
    expect(inScopes("TASKS.md", ["tasks/*.md", "TASKS.md"])).toBe(true)
    expect(inScopes("README.md", ["tasks/*.md", "TASKS.md"])).toBe(false)
  })
})

describe("origin allowlist", () => {
  it("allows wildcard", () => {
    expect(isAllowedOrigin("https://any.site", ["*"])).toBe(true)
  })

  it("allows opaque origin when listed", () => {
    expect(isAllowedOrigin("null", ["null"])).toBe(true)
  })

  it("allows localhost any port when rule omits port", () => {
    expect(isAllowedOrigin("http://localhost:3000", ["http://localhost"])).toBe(true)
  })

  it("allows listed origin", () => {
    expect(isAllowedOrigin("http://localhost:3000", ["http://localhost:3000"])).toBe(true)
  })

  it("rejects non-listed origin", () => {
    expect(isAllowedOrigin("https://evil.test", ["http://localhost:3000"])).toBe(false)
  })
})
