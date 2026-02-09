import { describe, expect, test } from "bun:test"
import { collectOpenProjectDeepLinks, drainPendingDeepLinks, parseDeepLink } from "./deep-links"
import { displayName, errorMessage, getDraggableId, syncWorkspaceOrder, workspaceKey } from "./helpers"

describe("layout deep links", () => {
  test("parses open-project deep links", () => {
    expect(parseDeepLink("opencode://open-project?directory=/tmp/demo")).toBe("/tmp/demo")
  })

  test("ignores non-project deep links", () => {
    expect(parseDeepLink("opencode://other?directory=/tmp/demo")).toBeUndefined()
    expect(parseDeepLink("https://example.com")).toBeUndefined()
  })

  test("collects only valid open-project directories", () => {
    const result = collectOpenProjectDeepLinks([
      "opencode://open-project?directory=/a",
      "opencode://other?directory=/b",
      "opencode://open-project?directory=/c",
    ])
    expect(result).toEqual(["/a", "/c"])
  })

  test("drains global deep links once", () => {
    const target = {
      __OPENCODE__: {
        deepLinks: ["opencode://open-project?directory=/a"],
      },
    } as unknown as Window & { __OPENCODE__?: { deepLinks?: string[] } }

    expect(drainPendingDeepLinks(target)).toEqual(["opencode://open-project?directory=/a"])
    expect(drainPendingDeepLinks(target)).toEqual([])
  })
})

describe("layout workspace helpers", () => {
  test("normalizes trailing slash in workspace key", () => {
    expect(workspaceKey("/tmp/demo///")).toBe("/tmp/demo")
    expect(workspaceKey("C:\\tmp\\demo\\\\")).toBe("C:\\tmp\\demo")
  })

  test("keeps local first while preserving known order", () => {
    const result = syncWorkspaceOrder("/root", ["/root", "/b", "/c"], ["/root", "/c", "/a", "/b"])
    expect(result).toEqual(["/root", "/c", "/b"])
  })

  test("extracts draggable id safely", () => {
    expect(getDraggableId({ draggable: { id: "x" } })).toBe("x")
    expect(getDraggableId({ draggable: { id: 42 } })).toBeUndefined()
    expect(getDraggableId(null)).toBeUndefined()
  })

  test("formats fallback project display name", () => {
    expect(displayName({ worktree: "/tmp/app" })).toBe("app")
    expect(displayName({ worktree: "/tmp/app", name: "My App" })).toBe("My App")
  })

  test("extracts api error message and fallback", () => {
    expect(errorMessage({ data: { message: "boom" } }, "fallback")).toBe("boom")
    expect(errorMessage(new Error("broken"), "fallback")).toBe("broken")
    expect(errorMessage("unknown", "fallback")).toBe("fallback")
  })
})
