import { describe, expect, test } from "bun:test"
import { permissionPreFilter } from "../../src/permission/hardener"

describe("permissionPreFilter", () => {
  test("auto-allows read", () => {
    expect(permissionPreFilter("read")).toBe("allow")
  })
  test("auto-allows glob", () => {
    expect(permissionPreFilter("glob")).toBe("allow")
  })
  test("auto-allows grep", () => {
    expect(permissionPreFilter("grep")).toBe("allow")
  })
  test("auto-allows todowrite", () => {
    expect(permissionPreFilter("todowrite")).toBe("allow")
  })
  test("bash defaults to ask", () => {
    expect(permissionPreFilter("bash")).toBe("default")
  })
  test("write defaults to ask", () => {
    expect(permissionPreFilter("write")).toBe("default")
  })
  test("unknown tool defaults", () => {
    expect(permissionPreFilter("unknown_tool")).toBe("default")
  })
})
