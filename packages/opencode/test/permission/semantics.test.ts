import { test, expect, describe } from "bun:test"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { PermissionV2 } from "@opencode-ai/core/permission"

type Rule = PermissionV2.Rule

describe("Wildcard.match", () => {
  test("`*` matches any run of characters", () => {
    expect(Wildcard.match("git push origin", "git *")).toBe(true)
  })
  test("trailing ` *` is optional (bare command matches)", () => {
    expect(Wildcard.match("git push", "git push *")).toBe(true)
  })
  test("`?` matches exactly one character", () => {
    expect(Wildcard.match("ab", "a?")).toBe(true)
    expect(Wildcard.match("abc", "a?")).toBe(false)
  })
  test("backslashes are normalized to `/`", () => {
    expect(Wildcard.match("a\\b\\c", "a/b/*")).toBe(true)
  })
  test("exact and non-matching", () => {
    expect(Wildcard.match("bash", "bash")).toBe(true)
    expect(Wildcard.match("bash", "edit")).toBe(false)
  })
  test("case sensitivity follows the platform (intentional)", () => {
    // case-insensitive on Windows, case-sensitive elsewhere (mirrors OS behavior)
    const expected = process.platform === "win32"
    expect(Wildcard.match("RM file", "rm *")).toBe(expected)
  })
})

describe("PermissionV2.evaluate (last match wins)", () => {
  const rules: Rule[] = [
    { permission: "bash", pattern: "*", action: "deny" },
    { permission: "bash", pattern: "git *", action: "allow" },
  ]
  test("later, more specific allow overrides an earlier blanket deny", () => {
    expect(PermissionV2.evaluate("bash", "git push", rules).action).toBe("allow")
  })
  test("falls back to the blanket deny for non-matching patterns", () => {
    expect(PermissionV2.evaluate("bash", "rm -rf", rules).action).toBe("deny")
  })
  test("defaults to `ask` when nothing matches", () => {
    expect(PermissionV2.evaluate("read", "anything", []).action).toBe("ask")
  })
})

describe("PermissionV2.disabled (intentional coarse UI gate)", () => {
  test("a blanket `*` deny disables the tool", () => {
    const d = PermissionV2.disabled(["bash"], [{ permission: "*", pattern: "*", action: "deny" }])
    expect(d.has("bash")).toBe(true)
  })
  test("a narrower allow BEFORE a trailing blanket deny does NOT keep it enabled", () => {
    const d = PermissionV2.disabled(
      ["bash"],
      [
        { permission: "bash", pattern: "git *", action: "allow" },
        { permission: "bash", pattern: "*", action: "deny" },
      ],
    )
    expect(d.has("bash")).toBe(true)
  })
  test("a narrower allow AFTER a blanket deny re-enables it (last match wins)", () => {
    const d = PermissionV2.disabled(
      ["bash"],
      [
        { permission: "bash", pattern: "*", action: "deny" },
        { permission: "bash", pattern: "git *", action: "allow" },
      ],
    )
    expect(d.has("bash")).toBe(false)
  })
  test("specific-only denies (no blanket `*`) do not disable", () => {
    const d = PermissionV2.disabled(["task"], [{ permission: "task", pattern: "orch-*", action: "deny" }])
    expect(d.has("task")).toBe(false)
  })
  test("edit-family tools collapse onto the `edit` permission", () => {
    const d = PermissionV2.disabled(
      ["edit", "write", "apply_patch"],
      [{ permission: "edit", pattern: "*", action: "deny" }],
    )
    expect(d.has("edit")).toBe(true)
    expect(d.has("write")).toBe(true)
    expect(d.has("apply_patch")).toBe(true)
  })
})
