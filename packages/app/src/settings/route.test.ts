import { describe, expect, test } from "bun:test"
import { parseSettingsView, settingsViewRedirect, settingsViewUrl, type SettingsView } from "./route"

describe("settings route", () => {
  test("keeps root preferences at the canonical route", () => {
    expect(settingsViewUrl({ type: "root", tab: "general" })).toBe("/settings")
    expect(parseSettingsView("", false)).toEqual({ type: "root", tab: "general", subtab: undefined })
  })

  test("round trips root, server, and project pages", () => {
    const root: SettingsView = { type: "root", tab: "appearance" }
    const server: SettingsView = { type: "server", server: "wsl:Debian", tab: "models" }
    const project: SettingsView = {
      type: "project",
      server: "local",
      project: "C:\\work folder",
      parent: "server",
      tab: "extensions",
      subtab: "skills",
    }

    expect(parseSettingsView(new URL(settingsViewUrl(root), "http://localhost").search, false)).toEqual({
      ...root,
      subtab: undefined,
    })
    expect(parseSettingsView(new URL(settingsViewUrl(server), "http://localhost").search, true)).toEqual({
      ...server,
      subtab: undefined,
    })
    expect(parseSettingsView(new URL(settingsViewUrl(project), "http://localhost").search, true)).toEqual(project)
  })

  test("derives project ancestry and keeps search reveal state transient", () => {
    expect(
      parseSettingsView("?server=local&project=%2Fwork&tab=extensions&subtab=plugins", false, {
        target: "settings-plugin",
        searchActivation: 2,
      }),
    ).toEqual({
      type: "project",
      server: "local",
      project: "/work",
      parent: "root",
      tab: "extensions",
      subtab: "plugins",
      target: "settings-plugin",
      searchActivation: 2,
    })
  })

  test("keeps a restored server page until the server lists load", () => {
    const view: SettingsView = { type: "server", server: "wsl:Debian", tab: "models" }
    const local = { key: "local", connected: true, starting: false }
    const wsl = { key: "wsl:Debian", connected: false, starting: true }

    expect(settingsViewRedirect({ view, loaded: false, servers: [local] })).toBeUndefined()
    expect(settingsViewRedirect({ view, loaded: true, servers: [local, wsl] })).toBeUndefined()
    expect(settingsViewRedirect({ view, loaded: true, servers: [local] })).toEqual({ type: "back" })
  })

  test("keeps a project page while its server starts", () => {
    const view: SettingsView = {
      type: "project",
      server: "wsl:Debian",
      project: "/work",
      parent: "server",
      tab: "general",
    }
    const local = { key: "local", connected: true, starting: false }

    expect(
      settingsViewRedirect({
        view,
        loaded: true,
        servers: [local, { key: "wsl:Debian", connected: false, starting: true }],
      }),
    ).toBeUndefined()
    expect(
      settingsViewRedirect({
        view,
        loaded: true,
        servers: [local, { key: "wsl:Debian", connected: false, starting: false }],
      }),
    ).toEqual({ type: "server", server: "wsl:Debian" })
  })

  test("moves a single server's page to the root settings", () => {
    const local = { key: "local", connected: true, starting: false }
    expect(
      settingsViewRedirect({
        view: { type: "server", server: "local", tab: "general" },
        loaded: true,
        servers: [local],
      }),
    ).toEqual({ type: "root", tab: "servers" })
    expect(
      settingsViewRedirect({
        view: { type: "server", server: "local", tab: "models" },
        loaded: true,
        servers: [local],
      }),
    ).toEqual({ type: "root", tab: "models" })
  })

  test("falls back for invalid scope and tab combinations", () => {
    expect(parseSettingsView("?tab=unknown", false)).toEqual({ type: "root", tab: "general" })
    expect(parseSettingsView("?project=%2Fwork&tab=extensions", false)).toEqual({ type: "root", tab: "general" })
    expect(parseSettingsView("?server=local&tab=about", true)).toEqual({ type: "root", tab: "general" })
    expect(parseSettingsView("?tab=toString", false)).toEqual({ type: "root", tab: "general" })
    expect(parseSettingsView("?tab=extensions&subtab=toString", false)).toEqual({
      type: "root",
      tab: "extensions",
      subtab: undefined,
    })
    expect(parseSettingsView("?tab=extensions&subtab=lsps", false)).toEqual({
      type: "root",
      tab: "extensions",
      subtab: undefined,
    })
  })
})
