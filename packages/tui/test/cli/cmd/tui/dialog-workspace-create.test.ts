import { describe, expect, test } from "bun:test"
import { buildDetails } from "../../../../src/component/dialog-workspace-create"

describe("buildDetails", () => {
  test("includes directory when present", () => {
    const workspace = { id: "wrk_a", name: "alpha", directory: "/home/user/proj", type: "worktree", timeUsed: 500, branch: "feat", extra: null, projectID: "proj" }
    const details = buildDetails(workspace)
    expect(details?.some((l) => l.includes("/home/user/proj"))).toBe(true)
  })

  test("returns undefined when no details", () => {
    const workspace = { id: "wrk_a", name: "alpha", type: "local", timeUsed: 0, extra: null, projectID: "proj" }
    expect(buildDetails(workspace)).toBeUndefined()
  })
})
