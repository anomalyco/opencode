import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"

const src = readFileSync(resolve(import.meta.dir, "../../../src/cli/cmd/tui/routes/session/index.tsx"), "utf-8")

describe("ToolPart shouldHide visibility logic", () => {
  // Regression: shouldHide hid ALL completed tool parts, including external
  // task/status parts created by `oc check` / `oc status`. Because the
  // running→completed transition can arrive within a single render batch,
  // these parts were invisible before the user could see them.
  // The fix exempts tool types "task" and "status" from auto-hiding.

  test("shouldHide block exempts task and status tool types", () => {
    // Find the shouldHide memo body
    const match = src.match(/const shouldHide = createMemo\(\(\) => \{([\s\S]*?)\}\)/)
    expect(match).not.toBeNull()
    const body = match![1]
    expect(body).toContain('"task"')
    expect(body).toContain('"status"')
    // The exemption must return false (not hidden) for those types
    expect(body).toMatch(/props\.part\.tool === "task".*return false|return false.*props\.part\.tool === "task"/s)
  })

  test("shouldHide exemption covers both task and status in one guard", () => {
    // Both types should appear together in a single conditional so neither
    // can be removed without the other being noticed.
    const match = src.match(
      /props\.part\.tool === "task"[^;]*props\.part\.tool === "status"|props\.part\.tool === "status"[^;]*props\.part\.tool === "task"/,
    )
    expect(match).not.toBeNull()
  })
})
