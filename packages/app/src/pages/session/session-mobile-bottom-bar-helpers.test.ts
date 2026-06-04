import { describe, expect, test } from "bun:test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { isProjectBottomBarActive, projectBottomBarHref } from "./session-mobile-bottom-bar-helpers"

describe("session mobile bottom bar helpers", () => {
  test("links project buttons to the root worktree", () => {
    expect(projectBottomBarHref({ worktree: "/repo/root" })).toBe(`/?project=${base64Encode("/repo/root")}`)
  })

  test("matches active project directories with trailing slash normalization and sandboxes", () => {
    const project = { worktree: "/repo/root///", sandboxes: ["/repo/sandbox-a", "/repo/sandbox-b///"] }

    expect(isProjectBottomBarActive("/repo/root", project)).toBe(true)
    expect(isProjectBottomBarActive("/repo/sandbox-b", project)).toBe(true)
    expect(isProjectBottomBarActive("/repo/other", project)).toBe(false)
  })
})
