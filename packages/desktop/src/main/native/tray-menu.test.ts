import { describe, expect, test } from "bun:test"
import { trayMenu } from "./tray-menu"
import type { TraySessions } from "./tray-sessions"
import { TRAY_LABEL_WIDTH, trayLabelWidth } from "./tray-label"

const empty: TraySessions = { state: "ready", sessions: [], working: 0, attention: 0, more: false }

describe("tray menu", () => {
  test("requests top-aligned icons only for native two-line items", () => {
    const actions = { open() {}, trigger() {}, docs() {}, quit() {}, session() {} }
    const snapshot: TraySessions = {
      ...empty,
      sessions: [{ id: "session", directory: "/repo", status: "idle", cost: 0 }],
    }
    const icons = {
      action: (name: string) => `${name}.png`,
      session: (_session: unknown, twoLines: boolean) => (twoLines ? "top-aligned.png" : "normal.png"),
      spacer: () => "transparent.png",
    }
    const native = trayMenu(actions, snapshot, icons, true)
    const fallback = trayMenu(actions, snapshot, icons, false)
    expect(native.find((item) => "id" in item && item.id === "session:session")?.icon).toBe("top-aligned.png")
    expect(fallback.find((item) => "id" in item && item.id === "session:session")?.icon).toBe("normal.png")
  })
  test("truncates titles and project names while keeping context and cost on one line", () => {
    const actions = { open() {}, trigger() {}, docs() {}, quit() {}, session() {} }
    const title = "A very long session title\n".repeat(6)
    const directory = `/code/${"项目名称".repeat(20)}`
    const menu = trayMenu(actions, {
      ...empty,
      sessions: [{ id: "long", title, directory, status: "idle", context: 52, cost: 12.34 }],
    })
    const index = menu.findIndex((item) => "id" in item && item.id === "session:long")
    const session = menu[index]
    const detail = "sublabel" in session ? session.sublabel : undefined
    expect(session.label?.endsWith("…")).toBe(true)
    expect(session.label).not.toMatch(/[\r\n\u2028\u2029]/u)
    expect(trayLabelWidth(session.label ?? "")).toBeLessThanOrEqual(TRAY_LABEL_WIDTH)
    expect(detail).toContain("… · Context 52% · $12.34")
    expect(trayLabelWidth(detail ?? "")).toBeLessThanOrEqual(TRAY_LABEL_WIDTH)
    expect("toolTip" in session && session.toolTip).toContain(title)
    expect("toolTip" in session && session.toolTip).toContain(directory)
  })
  test("keeps View all sessions text-only", () => {
    const actions = { open() {}, trigger() {}, docs() {}, quit() {}, session() {} }
    const menu = trayMenu(
      actions,
      { ...empty, more: true },
      {
        action: (name) => `${name}.png`,
        session: (item) => `${item.id}.png`,
        spacer: () => "transparent.png",
      },
    )
    const item = menu.find((item) => item.label === "View all sessions…")
    expect(item).toBeDefined()
    expect(item && "icon" in item).toBe(false)
  })
  test("places an icon before every session and footer action", () => {
    const actions = { open() {}, trigger() {}, docs() {}, quit() {}, session() {} }
    const menu = trayMenu(
      actions,
      { ...empty, sessions: [{ id: "session", directory: "/repo", status: "idle", cost: 0 }] },
      {
        action: (name) => `${name}.png`,
        session: (item) => `${item.id}.png`,
        spacer: () => "transparent.png",
      },
    )
    expect(menu.filter((item) => item.click).map((item) => item.icon)).toEqual([
      "session.png",
      "newAgent.png",
      "settings.png",
      "docs.png",
      "quit.png",
    ])
    expect(menu.some((item) => item.label === "repo · No context · $0.00")).toBe(false)
  })
  test("provides real app actions without starting model execution", () => {
    const actions: string[] = []
    const menu = trayMenu(
      {
        open: () => actions.push("open"),
        trigger: (id) => actions.push(id),
        docs: () => actions.push("docs"),
        quit: () => actions.push("quit"),
        session: (id) => actions.push(id),
      },
      empty,
    )
    expect(menu.flatMap((item) => item.label ?? [])).toEqual([
      "No active sessions",
      "New Agent…",
      "Settings",
      "Docs",
      "Quit",
    ])
    menu.forEach((item) => item.click?.())
    expect(actions).toEqual(["tab.new", "settings.open", "docs", "quit"])
  })

  test("shows the grouped summary before actions and opens the exact session", () => {
    const opened: string[] = []
    const actions = { open() {}, trigger() {}, docs() {}, quit() {}, session: (id: string) => opened.push(id) }
    const snapshot: TraySessions = {
      ...empty,
      attention: 1,
      working: 1,
      sessions: [
        {
          id: "question",
          title: "Fix login",
          directory: "/code/dashboard",
          status: "question",
          context: 52,
          cost: 0.12,
          placement: { type: "worktree", directory: "/code/worktrees/login-fix" },
        },
        { id: "working", title: "CSV export", directory: "C:\\code\\api", status: "working", tokens: 1024, cost: 1.25 },
        {
          id: "idle",
          directory: "/code/cli",
          status: "idle",
          cost: 0,
          placement: { type: "local", directory: "/code/cli" },
        },
      ],
    }
    const menu = trayMenu(actions, snapshot)
    expect(menu.flatMap((item) => item.label ?? []).slice(0, 5)).toEqual([
      "Needs you",
      "Fix login",
      "Active sessions",
      "CSV export",
      "Untitled session",
    ])
    expect(menu.some((item) => item.label === "Working")).toBe(false)
    const session = menu.find((item) => "id" in item && item.id === "session:question")
    expect(session && "sublabel" in session && session.sublabel).toBe("dashboard · Context 52% · $0.12")
    expect(session && "toolTip" in session && session.toolTip).toContain("Worktree · login-fix\n/code/dashboard")
    expect(session && "toolTip" in session && session.toolTip).toContain("Context 52%\nCost $0.12")
    expect(session && "toolTip" in session && session.toolTip).not.toContain("Context:")
    session?.click?.()
    expect(opened).toEqual(["question"])
    expect(menu.some((item) => item.label === "dashboard · Context 52% · $0.12")).toBe(false)
    const local = menu.find((item) => "id" in item && item.id === "session:idle")
    expect(local && "toolTip" in local && local.toolTip).toContain("Local\n/code/cli")
  })

  test("retains aligned details where native sublabels are unavailable", () => {
    const actions = { open() {}, trigger() {}, docs() {}, quit() {}, session() {} }
    const menu = trayMenu(
      actions,
      { ...empty, sessions: [{ id: "session", directory: "/repo", status: "idle", cost: 0 }] },
      {
        action: (name) => `${name}.png`,
        session: () => "project.png",
        spacer: () => "transparent.png",
      },
      false,
    )
    expect(menu.find((item) => item.label === "repo · No context · $0.00")?.icon).toBe("transparent.png")
  })

  test("uses the native shortcut column instead of adding shortcuts to action labels", () => {
    const actions = { open() {}, trigger() {}, docs() {}, quit() {}, session() {} }
    const menu = trayMenu(actions, empty, undefined, true, "darwin")
    expect(
      menu
        .filter((item) => item.click)
        .map((item) => [item.label, "accelerator" in item ? item.accelerator : undefined]),
    ).toEqual([
      ["New Agent…", "CommandOrControl+N"],
      ["Settings", "CommandOrControl+,"],
      ["Docs", undefined],
      ["Quit", "CommandOrControl+Q"],
    ])
  })

  test("shows plain options without shortcuts on Windows", () => {
    const actions = { open() {}, trigger() {}, docs() {}, quit() {}, session() {} }
    const menu = trayMenu(actions, empty, undefined, false, "win32")
    const options = menu.filter((item) => item.click)
    expect(options.map((item) => item.label)).toEqual(["New Agent…", "Settings", "Docs", "Quit"])
    expect(options.some((item) => "accelerator" in item)).toBe(false)
  })

  test("does not claim stale sessions are live after a connection failure", () => {
    const actions = { open() {}, trigger() {}, docs() {}, quit() {}, session() {} }
    const menu = trayMenu(actions, {
      ...empty,
      state: "offline",
      sessions: [{ id: "old", title: "Cached session", directory: "/repo", status: "working", cost: 0 }],
    })
    expect(menu[0].label).toBe("Unable to refresh sessions")
    expect(menu[1].label).toBe("Showing the last available update")
    expect(menu.some((item) => item.label === "New Agent…")).toBe(true)
    expect(trayMenu(actions, { ...empty, state: "loading" })[0].label).toBe("Loading sessions…")
  })
})
