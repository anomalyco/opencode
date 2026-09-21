import { describe, expect, test } from "bun:test"
import { parseSettingsView, settingsViewUrl, type SettingsView } from "./route"

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
