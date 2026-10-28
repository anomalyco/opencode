import { describe, expect, test } from "bun:test"
import { dict } from "@opencode/ui/i18n/en"
import en from "@/runtime/i18n/en"
import { settingsSearchIndex, type SettingsSearchServer } from "./search-index"
import { rankSettings } from "./search-results"

const strings = new Map(Object.entries({ ...dict, ...en }))

const project = { id: "proj_opencode", name: "OpenCode", worktree: "/projects/opencode" }

const servers: SettingsSearchServer[] = [
  { key: "local", name: "Local server", connected: true, projects: [project] },
  { key: "remote", name: "Build server", connected: true, projects: [project] },
]

function index(input: Partial<Parameters<typeof settingsSearchIndex>[0]> = {}) {
  return settingsSearchIndex({
    servers,
    selected: "local",
    desktop: false,
    browser: false,
    mobile: false,
    translate: (key) => strings.get(key) ?? key,
    ...input,
  })
}

describe("settings search index", () => {
  test("indexes the selected server's pages and names it only when there are several servers", () => {
    const multi = rankSettings("models", index({ selected: "remote" })).filter((item) => item.topLevel)
    expect(multi.map((item) => item.view)).toEqual([
      { type: "root", server: "remote", tab: "models", target: undefined, subtab: undefined },
    ])
    const single = rankSettings("models", index({ servers: [servers[0]] })).find((item) => item.topLevel)!
    expect(single.server).toBe("local")
    expect(single.view).toEqual({ type: "root", tab: "models", target: undefined, subtab: undefined })
  })

  test("keeps unavailable servers discoverable without advertising unloaded settings", () => {
    const items = index({ servers: [{ ...servers[0], connected: false }] })
    expect(items.filter((item) => item.server).map((item) => item.id)).toEqual(["server:local"])
    expect(rankSettings("Local server", items)[0].view).toEqual({
      type: "root",
      tab: "servers",
      target: undefined,
      subtab: undefined,
    })
    expect(rankSettings("font", items)).toHaveLength(3)
  })

  test("only advertises settings supported by this platform", () => {
    const targets = (input: Parameters<typeof index>[0]) => index(input).map((item) => item.view.target)
    expect(targets({})).not.toContain("settings-pinch-zoom")
    expect(targets({})).not.toContain("settings-zoom")
    expect(targets({})).not.toContain("settings-experimental-browser")
    expect(targets({})).not.toContain("settings-show-project-icon")
    expect(targets({})).toContain("settings-tab-layout")
    expect(targets({ desktop: true })).toContain("settings-pinch-zoom")
    expect(targets({ desktop: true })).toContain("settings-zoom")
    expect(targets({ browser: true })).not.toContain("settings-experimental-browser")
    expect(targets({})).not.toContain("settings-show-project-icon")
    expect(targets({})).not.toContain("settings-mobile-titlebar-bottom")
    expect(targets({ mobile: true })).toContain("settings-mobile-titlebar-bottom")
  })

  test("uses section labels and stable identities independent of translated text", () => {
    const items = index()
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
    expect(index({ translate: (key) => `translated ${strings.get(key) ?? key}` }).map((item) => item.id)).toEqual(
      items.map((item) => item.id),
    )
    expect(
      rankSettings("agent", items)
        .filter((item) => item.title === "Agent")
        .map((item) => item.page),
    ).toEqual(["Desktop notifications", "Sound effects"])
    expect(rankSettings("follow-up behavior", items)[0].page).toBe("Preferences / General")
    expect(rankSettings("capsule", items)[0].view).toMatchObject({
      tab: "general",
      target: "settings-background-activity",
    })
    expect(items.some((item) => item.view.target === "settings-project-startup")).toBe(false)
  })

  test("retains project avatars and excludes color when a custom icon owns its appearance", () => {
    const withIcon = { ...project, icon: { color: "orange", override: "data:image/png;base64,example" } }
    const items = index({ servers: [{ ...servers[0], projects: [withIcon] }] })
    expect(rankSettings("opencode", items)[0].projectInfo).toEqual(withIcon)
    expect(rankSettings("opencode color", items)).toEqual([])
  })
})

describe("settings search ranking", () => {
  test("prioritizes top-level pages and omits generic project-setting copies", () => {
    expect(rankSettings("work", index({ servers: [servers[0]] })).map((item) => item.title)).toEqual([
      "Worktrees",
      "Default environment",
    ])
    expect(rankSettings("mcps", index()).map((item) => item.view)).toEqual([
      { type: "root", server: "local", tab: "extensions", target: undefined, subtab: "mcps" },
    ])
    expect(rankSettings("project name", index())).toEqual([])
    expect(rankSettings("startup", index())).toEqual([])
  })

  test("qualifies project settings by project name on the selected server", () => {
    expect(rankSettings("opencode name", index()).map((item) => item.view.target)).toEqual(["settings-project-name"])
    expect(rankSettings("opencode name", index({ selected: "remote" })).map((item) => item.server)).toEqual([
      "remote",
    ])
    expect(rankSettings("opencode skills", index()).map((item) => item.view.subtab)).toEqual(["skills"])
  })

  test("project names alone find projects, including names that are setting labels", () => {
    const items = index({ servers: [{ ...servers[0], projects: [{ ...project, name: "Skills" }] }] })
    expect(
      rankSettings("skills", items)
        .filter((item) => item.project)
        .map((item) => item.entity),
    ).toEqual([true])
    expect(rankSettings("opencode", index()).map((item) => item.entity)).toEqual([true])
  })

  test("normalizes whitespace, case, and Unicode in qualified names", () => {
    const items = index({ servers: [{ ...servers[0], projects: [{ ...project, name: "Open Code" }] }] })
    expect(rankSettings("  ＯＰＥＮ   ＣＯＤＥ   name  ", items).map((item) => item.view.target)).toEqual([
      "settings-project-name",
    ])
  })

  test("does not search paths or use the Projects category to match unrelated names", () => {
    const items = index({ servers: [{ ...servers[0], projects: [{ ...project, name: "codename" }] }] })
    expect(rankSettings("project name", items).some((item) => item.project)).toBe(false)
    expect(rankSettings("/projects/opencode", items)).toEqual([])
  })

  test("supports synonyms and fuzzy title matches while rejecting unrelated queries", () => {
    expect(rankSettings("dark mode", index())[0].view.target).toBe("settings-color-scheme")
    expect(rankSettings("termfont", index())[0].title).toBe("Terminal Font")
    expect(rankSettings("  ", index())).toEqual([])
    expect(rankSettings("zzzzzzzzz", index())).toEqual([])
  })
})
