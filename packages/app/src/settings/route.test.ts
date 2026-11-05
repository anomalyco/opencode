import { describe, expect, test } from "bun:test"
import { parseSettingsView, settingsViewRedirect, settingsViewUrl, type SettingsView } from "./route"

const parse = (view: SettingsView) => parseSettingsView(new URL(settingsViewUrl(view), "http://localhost").search)

describe("settings route", () => {
  test("keeps root preferences at the canonical route", () => {
    expect(settingsViewUrl({ type: "root", tab: "general" })).toBe("/settings")
    expect(parseSettingsView("")).toEqual({ type: "root", tab: "general", server: undefined, subtab: undefined })
  })

  test("round trips root pages, the selected server, and project pages", () => {
    const root: SettingsView = { type: "root", tab: "appearance" }
    const models: SettingsView = { type: "root", tab: "models", server: "wsl:Debian" }
    // Preferences with a selected server names its tab, which a link to the old server page lacks.
    const preferences: SettingsView = { type: "root", tab: "general", server: "wsl:Debian" }

    const project: SettingsView = {
      type: "project",
      server: "local",
      project: "C:\\work folder",
      tab: "extensions",
      subtab: "skills",
    }

    expect(parse(root)).toEqual({ ...root, server: undefined, subtab: undefined })
    expect(parse(models)).toEqual({ ...models, subtab: undefined })
    expect(settingsViewUrl(preferences)).toBe("/settings?server=wsl%3ADebian&tab=general")
    expect(parse(preferences)).toEqual({ ...preferences, subtab: undefined })
    expect(parse(project)).toEqual(project)
  })

  test("opens links to a server's old settings page on the flat pages with that server selected", () => {
    expect(parseSettingsView("?server=wsl%3ADebian")).toEqual({ type: "root", tab: "servers", server: "wsl:Debian" })
    expect(parseSettingsView("?server=wsl%3ADebian&tab=providers")).toEqual({
      type: "root",
      tab: "providers",
      server: "wsl:Debian",
      subtab: undefined,
    })
  })

  test("opens links to the desktop's old Plugins page on the Plugins tab of Extensions", () => {
    expect(parseSettingsView("?tab=plugins")).toEqual({
      type: "root",
      tab: "extensions",
      server: undefined,
      subtab: "plugins",
    })
  })

  test("keeps search reveal state transient", () => {
    expect(
      parseSettingsView("?server=local&project=%2Fwork&tab=extensions&subtab=plugins", {
        target: "settings-plugin",
        searchActivation: 2,
      }),
    ).toEqual({
      type: "project",
      server: "local",
      project: "/work",
      tab: "extensions",
      subtab: "plugins",
      target: "settings-plugin",
      searchActivation: 2,
    })
  })

  test("keeps a restored server selection until the server lists load, then drops a removed one", () => {
    const view: SettingsView = { type: "root", tab: "models", server: "wsl:Debian" }
    const local = { key: "local", availability: "ready" as const }
    const wsl = { key: "wsl:Debian", availability: "starting" as const }

    expect(settingsViewRedirect({ view, loaded: false, servers: [local] })).toBeUndefined()
    expect(settingsViewRedirect({ view, loaded: true, servers: [local, wsl] })).toBeUndefined()
    expect(settingsViewRedirect({ view, loaded: true, servers: [local] })).toEqual({
      type: "root",
      tab: "models",
      server: undefined,
    })
  })

  test("keeps a project page while its server starts and leaves it for a signed-out or unreachable one", () => {
    const view: SettingsView = { type: "project", server: "wsl:Debian", project: "/work", tab: "general" }
    const local = { key: "local", availability: "ready" as const }

    for (const availability of ["ready", "starting"] as const)
      expect(
        settingsViewRedirect({ view, loaded: true, servers: [local, { key: "wsl:Debian", availability }] }),
      ).toBeUndefined()

    // An HTTP server that answers 401 or not at all used to keep the route and render a blank page.
    for (const availability of ["unauthorized", "unreachable"] as const)
      expect(
        settingsViewRedirect({ view, loaded: true, servers: [local, { key: "wsl:Debian", availability }] }),
      ).toEqual({ type: "root", tab: "projects", server: "wsl:Debian" })
    expect(settingsViewRedirect({ view, loaded: true, servers: [local] })).toEqual({ type: "root", tab: "projects" })
  })

  test("falls back for invalid scope and tab combinations", () => {
    expect(parseSettingsView("?tab=unknown")).toEqual({ type: "root", tab: "general" })
    expect(parseSettingsView("?project=%2Fwork&tab=extensions")).toEqual({ type: "root", tab: "general" })
    expect(parseSettingsView("?tab=toString")).toEqual({ type: "root", tab: "general" })
    expect(parseSettingsView("?tab=extensions&subtab=toString")).toEqual({
      type: "root",
      tab: "extensions",
      server: undefined,
      subtab: undefined,
    })
    expect(parseSettingsView("?tab=extensions&subtab=lsps")).toEqual({
      type: "root",
      tab: "extensions",
      server: undefined,
      subtab: undefined,
    })
  })
})
