import { describe, expect, test } from "bun:test"
import { createWorkspaceTabs } from "@/context/workspace-tabs"
import { openWorkspaceAction } from "./workspace-actions"

describe("openWorkspaceAction", () => {
  test("opens file tabs with path state", () => {
    const workspace = createWorkspaceTabs()
    const id = openWorkspaceAction(workspace, { type: "openFile", path: "src/app.tsx" })

    expect(typeof id).toBe("string")
    expect(workspace.getTab(id ?? "")).toMatchObject({
      type: "file",
      title: "app.tsx",
      state: { path: "src/app.tsx" },
      isActive: true,
    })
  })

  test("opens browser tabs with normalized urls", () => {
    const workspace = createWorkspaceTabs()
    const id = openWorkspaceAction(workspace, { type: "openBrowser", url: "example.com/docs", activate: false })

    expect(typeof id).toBe("string")
    expect(workspace.getTab(id ?? "")).toMatchObject({
      type: "browser",
      title: "example.com",
      state: { url: "https://example.com/docs" },
      isActive: false,
    })
  })

  test("opens terminal tabs", () => {
    const workspace = createWorkspaceTabs()
    const id = openWorkspaceAction(workspace, { type: "openTerminal", title: "Build" })

    expect(workspace.getTab(id ?? "")).toMatchObject({
      type: "terminal",
      title: "Build",
      isActive: true,
    })
  })
})
