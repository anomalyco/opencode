import { describe, expect, test } from "bun:test"
import { workspaceOpenState } from "./sidebar-workspace-helpers"

describe("workspaceOpenState", () => {
  test("defaults to local workspace open", () => {
    expect(workspaceOpenState({}, "/tmp/root", true)).toBe(true)
  })

  test("uses persisted expansion state when present", () => {
    expect(workspaceOpenState({ "/tmp/root": false }, "/tmp/root", true)).toBe(false)
    expect(workspaceOpenState({ "/tmp/branch": true }, "/tmp/branch", false)).toBe(true)
  })
})
