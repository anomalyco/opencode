import { describe, expect, test } from "bun:test"
import { evaluatePluginBundle, inertModule, pluginIdAvailable, type InertModule } from "../src/gui/host"
import { Contract } from "../src/gui/core"
import { define } from "../src/gui/plugin"

const modules = new Map<string, object>([["@opencode/plugin/gui", { Contract, Plugin: { define } }]])

const evaluate = (code: string, process: "window" | "main" = "window") =>
  evaluatePluginBundle(code, {
    process,
    require: (name) => {
      const module = modules.get(name)

      if (module) return module

      if (name === "@opencode/plugin/gui/review") return inertModule(name)

      throw new Error(`not shared: ${name}`)
    },
  })

describe("plugin GUI bundles", () => {
  test("read the default export's declarations and setups", () => {
    const bundle = evaluate(`
      const sdk = require("@opencode/plugin/gui")
      exports.default = sdk.Plugin.define({
        os: ["macos"],
        i18n: { fr: { title: "Notes" } },
        setup() {},
      })
    `)

    expect(bundle.definition.os).toEqual(["macos"])
    expect(bundle.definition.i18n).toEqual({ fr: { title: "Notes" }, en: {} })
    expect(bundle.setup).toBeFunction()
    expect(bundle.main).toBeUndefined()
  })

  test("load in main when they import a window-only module, which main gets as a placeholder", () => {
    const code = `
      const review = require("@opencode/plugin/gui/review")
      exports.default = { setup: () => void review.Changes, main() {} }
    `

    expect(evaluate(code, "main").main).toBeFunction()
  })

  test("accept a bundler's default mode, where the plugin is the module itself", () => {
    expect(evaluate("module.exports = { main() {} }").main).toBeFunction()
  })

  // A malformed definition fails the plugin, not the host, and the error names the field so its author sees what to fix.
  test.each([
    ["a store without a schema", 'stores: { count: { scope: "global", initial: 0 } }', "schema"],
    ["an unknown OS", 'os: ["plan9"]', "os"],
    ["a lazy catalog", "i18n: { en: {}, fr: () => ({}) }", "fr"],
    ["a setup that is not a function", "setup: true", "setup"],
  ])("reject a plugin with %s", (_, field, named) => {
    const evaluated = () => evaluate(`exports.default = { ${field}, main() {} }`)

    expect(evaluated).toThrow("must default-export a `Plugin.define`")
    expect(evaluated).toThrow(named)
  })

  test("have at least one setup", () => {
    expect(() => evaluate("exports.default = {}")).toThrow("must have a window `setup`")
  })
})

/** What a bundle's module scope reports back through the test's `probe` module. */
type Seen = { ready?: InertModule; window?: boolean; name?: string }

describe("inert modules", () => {
  test("give module-scope code a placeholder that ignores writes and never poses as a promise or a class", async () => {
    const seen: Seen = {}

    const probe = {
      ready: (value: InertModule) => void (seen.ready = value),
      window: (value: boolean) => void (seen.window = value),
      name: (value: string) => void (seen.name = value),
    }

    evaluatePluginBundle(
      `
        const electron = require("electron")
        const probe = require("probe")
        electron.app.name = "patched"
        probe.ready(electron.app.whenReady())
        probe.window({} instanceof electron.BrowserWindow)
        probe.name(String(electron.app.name))
        module.exports = { main() {} }
      `,
      { process: "window", require: (name) => (name === "probe" ? probe : inertModule(name)) },
    )

    // A thenable would keep this promise pending forever.
    expect(await Promise.resolve(seen.ready)).toBe(seen.ready)
    expect(seen.window).toBe(false)
    expect(seen.name).toBe("[inert module electron]")
  })
})

test.each([
  ["acme", true],
  ["file", false],
  ["file.extra", false],
  ["tools", false],
  ["opencode", false],
  ["opencode.acme", false],
  ["opencode-acme", true],
])("a plugin GUI may take the id %s: %s", (id, available) => {
  const builtins = [{ id: "file" }, { id: "tools.git" }]

  expect(pluginIdAvailable(id, builtins)).toBe(available)
})
