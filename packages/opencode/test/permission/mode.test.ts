import { test, expect, describe } from "bun:test"
import { PermissionMode, getNextPermissionMode, DEFAULT_PERMISSION_MODE } from "../../src/permission/schema"
import { evaluatePermissionForMode } from "../../src/permission/mode"

describe("PermissionMode", () => {
  describe("getNextPermissionMode", () => {
    test("cycles from default to acceptEdits", () => {
      expect(getNextPermissionMode("default")).toBe("acceptEdits")
    })

    test("cycles from acceptEdits to plan", () => {
      expect(getNextPermissionMode("acceptEdits")).toBe("plan")
    })

    test("cycles from plan to bypassPermissions", () => {
      expect(getNextPermissionMode("plan")).toBe("bypassPermissions")
    })

    test("cycles from bypassPermissions back to default", () => {
      expect(getNextPermissionMode("bypassPermissions")).toBe("default")
    })
  })

  describe("DEFAULT_PERMISSION_MODE", () => {
    test("default permission mode is 'default'", () => {
      expect(DEFAULT_PERMISSION_MODE).toBe("default")
    })
  })

  describe("type validation", () => {
    test("PermissionMode schema accepts valid values", () => {
      expect(PermissionMode.parse("default")).toBe("default")
      expect(PermissionMode.parse("plan")).toBe("plan")
      expect(PermissionMode.parse("acceptEdits")).toBe("acceptEdits")
      expect(PermissionMode.parse("bypassPermissions")).toBe("bypassPermissions")
    })

    test("PermissionMode schema rejects invalid values", () => {
      expect(() => PermissionMode.parse("invalid")).toThrow()
      expect(() => PermissionMode.parse("read-only")).toThrow()
      expect(() => PermissionMode.parse("")).toThrow()
    })
  })
})

describe("evaluatePermissionForMode", () => {
  describe("bypassPermissions mode", () => {
    test("auto-approves all permissions", () => {
      expect(evaluatePermissionForMode("edit", "bypassPermissions")).toEqual({
        action: "allow",
        reason: "bypassPermissions mode",
      })
      expect(evaluatePermissionForMode("bash", "bypassPermissions")).toEqual({
        action: "allow",
        reason: "bypassPermissions mode",
      })
      expect(evaluatePermissionForMode("write", "bypassPermissions")).toEqual({
        action: "allow",
        reason: "bypassPermissions mode",
      })
      expect(evaluatePermissionForMode("read", "bypassPermissions")).toEqual({
        action: "allow",
        reason: "bypassPermissions mode",
      })
    })
  })

  describe("plan mode", () => {
    test("blocks edit permission", () => {
      expect(evaluatePermissionForMode("edit", "plan")).toEqual({
        action: "deny",
        reason: "plan mode blocks write operations",
      })
    })

    test("blocks write permission", () => {
      expect(evaluatePermissionForMode("write", "plan")).toEqual({
        action: "deny",
        reason: "plan mode blocks write operations",
      })
    })

    test("blocks bash permission", () => {
      expect(evaluatePermissionForMode("bash", "plan")).toEqual({
        action: "deny",
        reason: "plan mode blocks write operations",
      })
    })

    test("blocks apply_patch permission", () => {
      expect(evaluatePermissionForMode("apply_patch", "plan")).toEqual({
        action: "deny",
        reason: "plan mode blocks write operations",
      })
    })

    test("blocks multiedit permission", () => {
      expect(evaluatePermissionForMode("multiedit", "plan")).toEqual({
        action: "deny",
        reason: "plan mode blocks write operations",
      })
    })

    test("asks for read permission", () => {
      expect(evaluatePermissionForMode("read", "plan")).toEqual({ action: "ask" })
    })

    test("asks for glob permission", () => {
      expect(evaluatePermissionForMode("glob", "plan")).toEqual({ action: "ask" })
    })

    test("asks for grep permission", () => {
      expect(evaluatePermissionForMode("grep", "plan")).toEqual({ action: "ask" })
    })
  })

  describe("acceptEdits mode", () => {
    test("auto-approves edit permission", () => {
      expect(evaluatePermissionForMode("edit", "acceptEdits")).toEqual({
        action: "allow",
        reason: "acceptEdits mode auto-approves edits",
      })
    })

    test("auto-approves write permission", () => {
      expect(evaluatePermissionForMode("write", "acceptEdits")).toEqual({
        action: "allow",
        reason: "acceptEdits mode auto-approves edits",
      })
    })

    test("auto-approves apply_patch permission", () => {
      expect(evaluatePermissionForMode("apply_patch", "acceptEdits")).toEqual({
        action: "allow",
        reason: "acceptEdits mode auto-approves edits",
      })
    })

    test("auto-approves multiedit permission", () => {
      expect(evaluatePermissionForMode("multiedit", "acceptEdits")).toEqual({
        action: "allow",
        reason: "acceptEdits mode auto-approves edits",
      })
    })

    test("asks for bash permission", () => {
      expect(evaluatePermissionForMode("bash", "acceptEdits")).toEqual({ action: "ask" })
    })

    test("asks for read permission", () => {
      expect(evaluatePermissionForMode("read", "acceptEdits")).toEqual({ action: "ask" })
    })
  })

  describe("default mode", () => {
    test("asks for edit permission", () => {
      expect(evaluatePermissionForMode("edit", "default")).toEqual({ action: "ask" })
    })

    test("asks for write permission", () => {
      expect(evaluatePermissionForMode("write", "default")).toEqual({ action: "ask" })
    })

    test("asks for bash permission", () => {
      expect(evaluatePermissionForMode("bash", "default")).toEqual({ action: "ask" })
    })

    test("asks for read permission", () => {
      expect(evaluatePermissionForMode("read", "default")).toEqual({ action: "ask" })
    })
  })
})
