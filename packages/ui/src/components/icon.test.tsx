import { describe, expect, test } from "bun:test"
import { getIconViewBox } from "./icon-viewbox"
import { shouldUseSoftIcon } from "./icon-soft"
import { MCP_ICON } from "./mcp-icon"

describe("Icon preset", () => {
  test("uses soft icon when mapped", () => {
    expect(shouldUseSoftIcon("soft", "menu")).toBeTrue()
    expect(shouldUseSoftIcon("soft", "stop")).toBeTrue()
    expect(shouldUseSoftIcon("soft", "review")).toBeTrue()
    expect(shouldUseSoftIcon("soft", "globe")).toBeTrue()
  })

  test("falls back to sharp when soft icon is missing", () => {
    expect(shouldUseSoftIcon("soft", "bubble-5")).toBeFalse()
  })

  test("exports the custom mcp icon markup", () => {
    expect(MCP_ICON).toContain('fill="currentColor"')
    expect(MCP_ICON).toContain('M15.688 2.343')
    expect(MCP_ICON).toContain('M14.485 4.703')
  })

  test("uses a 24px viewBox for mcp", () => {
    expect(getIconViewBox("mcp")).toBe("0 0 24 24")
  })
})
