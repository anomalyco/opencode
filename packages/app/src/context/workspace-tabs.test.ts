import { describe, expect, test } from "bun:test"
import { createWorkspaceTabs, migrateWorkspaceState } from "./workspace-tabs"

describe("createWorkspaceTabs", () => {
  test("activates the next remaining tab when closing the active tab", () => {
    const workspace = createWorkspaceTabs()
    const first = workspace.openTab("review", { title: "Review" })
    const second = workspace.openTab("browser", { title: "Browser" })

    expect(workspace.state.activeTabId).toBe(second)

    workspace.closeTab(second)

    expect(workspace.state.activeTabId).toBe(first)
    expect(workspace.getTab(first)?.isActive).toBe(true)
    expect(workspace.getTab(second)).toBeUndefined()
  })

  test("keeps the current active tab when closing an inactive tab", () => {
    const workspace = createWorkspaceTabs()
    const first = workspace.openTab("review", { title: "Review" })
    const second = workspace.openTab("browser", { title: "Browser" })
    const third = workspace.openTab("file", { title: "README.md" })

    workspace.activateTab(second)
    workspace.closeTab(first)

    expect(workspace.state.activeTabId).toBe(second)
    expect(workspace.getTab(second)?.isActive).toBe(true)
    expect(workspace.getTab(third)?.isActive).toBe(false)
  })

  test("does not rewrite state when activating the already active tab", () => {
    const workspace = createWorkspaceTabs()
    const first = workspace.openTab("browser", { title: "Browser" })
    const active = workspace.activeTab()

    workspace.activateTab(first)

    expect(workspace.activeTab()).toBe(active)
  })

  test("migrates persisted state with a single active tab", () => {
    const state = migrateWorkspaceState({
      activeTabId: "browser-1",
      tabs: [
        {
          id: "review-1",
          type: "review",
          title: "Review",
          state: {},
          isPinned: true,
          isActive: true,
        },
        {
          id: "browser-1",
          type: "browser",
          title: "Docs",
          state: { url: "https://example.com" },
          isActive: false,
        },
        {
          id: "bad-1",
          type: "unknown",
          title: "Bad",
        },
      ],
    })

    expect(state.activeTabId).toBe("browser-1")
    expect(state.tabs).toHaveLength(2)
    expect(state.tabs.map((tab) => tab.isActive)).toEqual([false, true])
    expect(state.tabs[0]?.isPinned).toBe(true)
  })

  test("duplicates and reopens tabs with their state", () => {
    const workspace = createWorkspaceTabs()
    const browser = workspace.openTab("browser", {
      title: "Docs",
      state: { url: "https://example.com/docs" },
    })

    const duplicate = workspace.duplicateTab(browser)
    expect(typeof duplicate).toBe("string")
    expect(workspace.getTab(duplicate ?? "")?.state.url).toBe("https://example.com/docs")

    workspace.closeTab(duplicate ?? "")
    expect(workspace.canReopenClosedTab()).toBe(true)

    const reopened = workspace.reopenClosedTab()
    expect(typeof reopened).toBe("string")
    expect(workspace.getTab(reopened ?? "")?.title).toBe("Docs")
    expect(workspace.getTab(reopened ?? "")?.state.url).toBe("https://example.com/docs")
  })

  test("close others preserves pinned tabs and activates the target", () => {
    const workspace = createWorkspaceTabs()
    const review = workspace.openTab("review", { title: "Review", isPinned: true })
    const first = workspace.openTab("browser", { title: "One" })
    const second = workspace.openTab("file", { title: "Two" })

    workspace.closeOtherTabs(first)

    expect(workspace.getTab(review)).toBeDefined()
    expect(workspace.getTab(first)).toBeDefined()
    expect(workspace.getTab(second)).toBeUndefined()
    expect(workspace.state.activeTabId).toBe(first)
  })

  test("duplicates terminal tabs without reusing the same pty id", () => {
    const workspace = createWorkspaceTabs()
    const terminal = workspace.openTab("terminal", {
      title: "Terminal",
      state: { ptyId: "pty_one" },
    })

    const duplicate = workspace.duplicateTab(terminal)

    expect(typeof duplicate).toBe("string")
    expect(workspace.getTab(duplicate ?? "")?.state.ptyId).toBeUndefined()
  })

  test("duplicates chat tabs without reusing the same session id", () => {
    const workspace = createWorkspaceTabs()
    const chat = workspace.openTab("chat", {
      title: "Side Chat",
      state: {
        sessionID: "ses_one",
        agent: "build",
        modelProviderID: "anthropic",
        modelID: "claude-sonnet-4",
        modelVariant: "high",
      },
    })

    const duplicate = workspace.duplicateTab(chat)

    expect(typeof duplicate).toBe("string")
    expect(workspace.getTab(duplicate ?? "")?.state.sessionID).toBeUndefined()
    expect(workspace.getTab(duplicate ?? "")?.state.agent).toBe("build")
    expect(workspace.getTab(duplicate ?? "")?.state.modelProviderID).toBe("anthropic")
    expect(workspace.getTab(duplicate ?? "")?.state.modelID).toBe("claude-sonnet-4")
    expect(workspace.getTab(duplicate ?? "")?.state.modelVariant).toBe("high")
  })
})
