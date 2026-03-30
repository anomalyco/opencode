import { describe, expect, it } from "bun:test"
import { resolveSessionPluginUI } from "./plugin-ui"

describe("resolveSessionPluginUI", () => {
  it("builds web tabs and buttons from config", () => {
    const input = {
      ui: {
        session: {
          tabs: [
            {
              id: "kanban-roadmap",
              title: "Tasks",
              src: "http://localhost:3000?tasksFile=TASKS.md",
              permissions: {
                file: {
                  read: ["TASKS.md"],
                  write: ["TASKS.md"],
                },
              },
            },
          ],
          buttons: [
            {
              id: "tasks",
              label: "Tasks",
              tab: "kanban-roadmap",
            },
          ],
        },
      },
    }

    const ui = resolveSessionPluginUI(input, "/repo", "http://127.0.0.1:4096")
    expect(ui.tabs).toHaveLength(1)
    expect(ui.tabs[0]?.tab).toBe("web:kanban-roadmap")
    expect(ui.tabs[0]?.src).toContain("directory=%2Frepo")
    expect(ui.buttons).toEqual([
      {
        id: "tasks",
        label: "Tasks",
        tab: "web:kanban-roadmap",
      },
    ])
  })

  it("uses localhost defaults for missing origins", () => {
    const ui = resolveSessionPluginUI(
      {
        ui: {
          session: {
            tabs: [{ id: "x", title: "X", src: "http://localhost:3000" }],
          },
        },
      },
      "/repo",
      "http://127.0.0.1:4096",
    )

    expect(ui.tabs[0]?.origins).toContain("http://localhost")
    expect(ui.tabs[0]?.origins).toContain("http://127.0.0.1")
  })

  it("uses opaque origin default for app tabs", () => {
    const ui = resolveSessionPluginUI(
      {
        ui: {
          session: {
            tabs: [{ id: "kanban-roadmap", title: "Kanban", src: "app://plugin/kanban-roadmap/index.html" }],
          },
        },
      },
      "/repo",
      "http://127.0.0.1:4096",
    )

    expect(ui.tabs[0]?.origins).toEqual(["null"])
  })

  it("resolves relative src with base url", () => {
    const ui = resolveSessionPluginUI(
      {
        ui: {
          session: {
            tabs: [{ id: "kanban-roadmap", title: "Tasks", src: "/global/plugin/kanban-roadmap/index.html" }],
          },
        },
      },
      "/repo",
      "http://127.0.0.1:4096",
    )

    expect(ui.tabs[0]?.src.startsWith("http://127.0.0.1:4096/global/plugin/kanban-roadmap/index.html")).toBe(true)
  })
})
