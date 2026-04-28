import { describe, expect, test } from "bun:test"
import { getToolIcon } from "./tool-icon"

describe("tool icons", () => {
  test("maps tool names to clearer icons", () => {
    expect(getToolIcon("bash")).toBe("terminal")
    expect(getToolIcon("glob")).toBe("magnifying-glass")
    expect(getToolIcon("grep")).toBe("magnifying-glass")
    expect(getToolIcon("websearch")).toBe("globe")
    expect(getToolIcon("tool")).toBe("hammer")
    expect(getToolIcon("search")).toBe("mcp")
    expect(getToolIcon("whatever")).toBe("mcp")
  })
})
