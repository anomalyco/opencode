import { describe, expect, test } from "bun:test"
import {
  BROWSER_AT_OPTION,
  activateBrowserMention,
  buildAtOptions,
  getAtOptionKey,
} from "./browser-mention"

describe("browser mention helpers", () => {
  test("adds the browser option ahead of file matches with the expected label", () => {
    const options = buildAtOptions({
      agents: [],
      pinned: [{ type: "file", path: "src/browser.ts", display: "src/browser.ts", recent: true }],
      files: [{ type: "file", path: "src/browser-panel.tsx", display: "src/browser-panel.tsx" }],
    })

    expect(options.map((option) => option.type)).toEqual(["browser", "file", "file"])
    expect(options[0]).toEqual(BROWSER_AT_OPTION)
    expect(options[0]?.display).toBe("Browser — Control the in-app browser")
    expect(getAtOptionKey(options[0])).toBe("browser")
  })

  test("keeps agent options ahead of browser while still putting browser before files", () => {
    const options = buildAtOptions({
      agents: [{ type: "agent", name: "reviewer", display: "reviewer" }],
      pinned: [{ type: "file", path: "README.md", display: "README.md", recent: true }],
      files: [],
    })

    expect(options.map((option) => option.type)).toEqual(["agent", "browser", "file"])
    expect(options[1]?.display).toBe("Browser — Control the in-app browser")
  })

  test("activating the browser mention provisions the panel and returns literal text insertion", async () => {
    const selected: string[] = []
    const added: string[] = []
    const panel: boolean[] = []

    const result = await activateBrowserMention({
      api: {
        createBrowser: async () => ({
          browser: { id: "browser-1", title: "New Browser", url: "about:blank" },
          state: { activeBrowserId: "browser-1", browsers: [] },
        }),
        navigate: async (url: string) => ({ url, title: "" }),
      },
      browserStore: {
        store: { activeId: null, instances: {} },
        addBrowser: (id) => added.push(id),
        setActiveBrowser: (id) => selected.push(id),
        updateBrowser: () => undefined,
      },
      openPanel: () => panel.push(true),
      setPanelOpen: (open) => panel.push(open),
    })

    expect(result).toEqual({ type: "text", content: "@browser ", start: 0, end: 0 })
    expect(panel).toEqual([true, true])
    expect(added).toEqual(["browser-1"])
    expect(selected).toEqual(["browser-1"])
  })

  test("activating the browser mention selects an existing browser when active id is missing", async () => {
    const selected: string[] = []
    const added: string[] = []
    const panel: boolean[] = []
    const created: string[] = []

    const result = await activateBrowserMention({
      api: {
        createBrowser: async () => {
          created.push("browser-new")
          return {
            browser: { id: "browser-new", title: "New Browser", url: "about:blank" },
            state: { activeBrowserId: "browser-new", browsers: [] },
          }
        },
        navigate: async (url: string) => ({ url, title: "" }),
      },
      browserStore: {
        store: {
          activeId: null,
          instances: {
            "browser-existing": {
              id: "browser-existing",
              title: "Existing Browser",
              url: "https://opencode.ai",
              visible: true,
            },
          },
        },
        addBrowser: (id) => added.push(id),
        setActiveBrowser: (id) => selected.push(id),
        updateBrowser: () => undefined,
      },
      openPanel: () => panel.push(true),
      setPanelOpen: (open) => panel.push(open),
    })

    expect(result).toEqual({ type: "text", content: "@browser ", start: 0, end: 0 })
    expect(panel).toEqual([true, true])
    expect(created).toEqual([])
    expect(added).toEqual([])
    expect(selected).toEqual(["browser-existing"])
  })
})
