import { describe, expect, test } from "bun:test"
import { runInNewContext } from "node:vm"
import { announcementCopy, announcements } from "~/component/site/announcement"
import { preloadSettings, themeScript } from "~/component/site/preload-settings"
import { bannerDismissScript } from "~/component/site/site-banner-script"
import { migrateSettings, siteSettingsDefaults, siteSettingsSchema } from "~/component/site/settings"
import { z } from "zod"

// The pre-paint scripts run inline while the page is parsed, as strings built from functions in
// settings.ts and nav-config.ts. A function that reaches for anything outside its arguments throws
// there, the scripts swallow it, and every saved setting then waits for the page's code (Nov 2026:
// one missing reference did exactly that). These tests run the exact strings Site renders, in a
// context with nothing but the few browser objects they use.

type Element = ReturnType<typeof element>

function element(tag: string, matchAll = false) {
  const attributes = new Map<string, string>()
  const style = new Map<string, string>()
  const children: unknown[] = []
  return {
    tagName: tag.toUpperCase(),
    nodeType: 1,
    isConnected: true,
    textContent: "",
    id: "",
    content: "",
    media: "",
    dataset: {} as Record<string, string>,
    attributes,
    children,
    style: {
      values: style,
      setProperty: (name: string, value: string) => void style.set(name, value),
      removeProperty: (name: string) => void style.delete(name),
    },
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    hasAttribute: (name: string) => attributes.has(name),
    removeAttribute: (name: string) => void attributes.delete(name),
    // A node that matches every selector runs every rule (the root's rules run on the root itself).
    matches: () => matchAll,
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    appendChild: (child: unknown) => (children.push(child), child),
  }
}

function run(script: string, saved: unknown, theme?: string, stored: Record<string, string> = {}) {
  const errors: unknown[] = []
  // The rule loop and the whole script swallow errors on purpose; the test reports them instead.
  const swallowed = ["catch{return}", "catch{}})()"]
  swallowed.forEach((text) => expect(script.includes(text) || !script.includes("const saved=(")).toBe(true))
  const code = script
    .replace("catch{return}", "catch(error){__errors.push(error);return}")
    .replace(/catch\{\}\}\)\(\)$/, "catch(error){__errors.push(error)}})()")
  const root = element("div")
  const head = element("head")
  const observers: ((records: { addedNodes: unknown[] }[], observer: unknown) => void)[] = []
  const storage = new Map<string, string>(Object.entries({ "opencode-site-settings-v3": JSON.stringify(saved) }))
  if (theme) storage.set("opencode-theme", theme)
  Object.entries(stored).forEach(([key, value]) => storage.set(key, value))
  // The light and dark theme-color tags the theme script fills in.
  const metas = ["(prefers-color-scheme: light)", "(prefers-color-scheme: dark)"].map((media) =>
    Object.assign(element("meta"), { media }),
  )
  runInNewContext(code, {
    __errors: errors,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null },
    location: { search: "" },
    URLSearchParams,
    screen: { width: 1440, height: 900 },
    document: {
      currentScript: { parentElement: root },
      head,
      createElement: (tag: string) => element(tag),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: (selector: string) => (selector === 'meta[name="theme-color"]' ? metas : []),
    },
    MutationObserver: class {
      constructor(callback: (records: { addedNodes: unknown[] }[], observer: unknown) => void) {
        observers.push(callback)
      }
      observe() {}
      disconnect() {}
    },
  })
  // A node added after the script, matching every rule's selector.
  const added = element("section", true)
  observers.forEach((callback) => callback([{ addedNodes: [added] }], { disconnect() {} }))
  return {
    errors,
    root,
    added,
    head,
    metas,
    styles: (head.children as Element[]).map((child) => child.textContent).join(""),
  }
}

/** A saved value different from the default for every enum setting, from the schema itself. */
function changedSettings() {
  const shape = siteSettingsSchema.shape as Record<string, z.ZodType>
  const defaults = siteSettingsDefaults as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(shape).flatMap(([key, field]) => {
      const inner = field instanceof z.ZodCatch ? (field.removeCatch() as z.ZodType) : field
      if (!(inner instanceof z.ZodEnum)) return []
      const other = (inner.options as unknown[]).find((option) => option !== defaults[key])
      return other === undefined ? [] : [[key, other]]
    }),
  )
}

describe("pre-paint settings script", () => {
  test("runs every rule without an error, whatever is saved", () => {
    const changed = changedSettings()
    expect(Object.keys(changed).length).toBeGreaterThan(50)
    for (const saved of [{}, siteSettingsDefaults, changed]) {
      const result = run(preloadSettings, saved)
      expect(result.errors.map(String)).toEqual([])
    }
  })

  test("applies representative saved settings to the root before first paint", () => {
    // Saved after every migration (their revision markers, whatever they are now), so the values
    // below are a visitor's own picks.
    const current = migrateSettings({}) as Record<string, unknown>
    const result = run(preloadSettings, {
      ...current,
      homeAnnouncement: "on",
      announcementStyle: "banner",
      docsVariants: { ...(current.docsVariants as object), config: "2" },
      navConfig: siteSettingsDefaults.navConfig.map((entry, index) => ({ ...entry, visible: index !== 0 })),
      arcadeMode: "image",
    })
    expect(result.errors.map(String)).toEqual([])
    expect(result.root.hasAttribute("data-banner")).toBe(true)
    expect(result.root.getAttribute("data-docs-variants")).toContain("config-2")
    // The nav list's rules: the first item hidden.
    expect(result.styles).toContain(`li[data-nav-id="${siteSettingsDefaults.navConfig[0].id}"]{order:`)
    expect(result.styles).toContain("display:none")
  })

  test("puts a saved mono font ahead of the stack and preloads a web font", () => {
    const web = run(preloadSettings, { monoFont: "IBM Plex Mono", monoFontRevision: 2 })
    expect(web.errors.map(String)).toEqual([])
    expect(web.root.style.values.get("--mono-choice")).toBe(`"IBM Plex Mono",`)
    expect(web.head.children.some((child) => (child as Element).tagName === "LINK")).toBe(true)
    const local = run(preloadSettings, { monoFont: 'Geist Mono"', monoFontRevision: 2 })
    expect(local.root.style.values.get("--mono-choice")).toBe(`"Geist Mono",`)
    expect(local.head.children.some((child) => (child as Element).tagName === "LINK")).toBe(false)
    expect(run(preloadSettings, { monoFont: "OpenTUI Mono" }).root.style.values.has("--mono-choice")).toBe(false)
    // A mono font saved before OpenTUI Mono became the default resets to it once.
    expect(run(preloadSettings, { monoFont: "Geist Mono" }).root.style.values.has("--mono-choice")).toBe(false)
  })

  test("migrates old settings without an error", () => {
    const result = run(preloadSettings, { arcadeMode: "hybrid", cardVideoCut: "straight", navOrder: ["docs"] })
    expect(result.errors.map(String)).toEqual([])
  })

  test("theme script sets the saved theme", () => {
    const result = run(themeScript(true), { lightBackground: "#fafafa" }, "dark")
    expect(result.errors.map(String)).toEqual([])
    expect(result.root.dataset.theme).toBe("dark")
  })

  test("theme script follows the saved light background on the development server", () => {
    const result = run(themeScript(true), { lightBackground: "#fafafa" }, "light")
    expect(result.metas.map((meta) => meta.content)).toEqual(["#fafafa", "#fafafa"])
  })
})

// Production has no Settings or Design mode: Site renders only the theme and banner scripts, and
// neither reads a designer's saved settings or copy. The tests run as production
// (import.meta.env.DEV is unset outside Vite).
describe("pre-paint scripts in production", () => {
  test("the theme script keeps the visitor's theme but ignores a saved light background", () => {
    const result = run(themeScript(false), { lightBackground: "#fafafa" }, "light")
    expect(result.errors.map(String)).toEqual([])
    expect(result.root.dataset.theme).toBe("light")
    expect(result.metas.map((meta) => meta.content)).toEqual([
      siteSettingsDefaults.lightBackground,
      siteSettingsDefaults.lightBackground,
    ])
  })

  test("the banner stays dismissed, whatever Design mode copy is saved", () => {
    // A designer's saved choice of another message, which production ignores.
    const copy = JSON.stringify({ choice: { "home.announcement": 2 }, custom: {} })
    const banner = (dismissed: string) => {
      const root = element("div")
      root.setAttribute("data-banner", "")
      const storage: Record<string, string> = {
        "opencode-announcement-dismissed": dismissed,
        "opencode-site-design-copy-v2": copy,
      }
      runInNewContext(bannerDismissScript, {
        localStorage: { getItem: (key: string) => storage[key] ?? null },
        document: { currentScript: { parentElement: root } },
      })
      return root.hasAttribute("data-banner")
    }
    expect(banner(announcementCopy(announcements[0]))).toBe(false)
    expect(banner("An older message")).toBe(true)
  })

  test("the scripts never read saved settings or Design mode copy", () => {
    for (const script of [themeScript(false), bannerDismissScript]) {
      expect(script).not.toContain("opencode-site-settings-v3")
      expect(script).not.toContain("opencode-site-design-copy-v2")
    }
  })
})
