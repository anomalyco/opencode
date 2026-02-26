import { describe, expect, test } from "bun:test"
import { sidebarExpanded } from "./sidebar-shell-helpers"

describe("sidebarExpanded", () => {
  test("expands on mobile regardless of desktop open state", () => {
    expect(sidebarExpanded(true, false)).toBe(true)
  })

  test("follows desktop open state when not mobile", () => {
    expect(sidebarExpanded(false, true)).toBe(true)
    expect(sidebarExpanded(false, false)).toBe(false)
  })
})
