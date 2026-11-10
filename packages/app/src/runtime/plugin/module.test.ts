import { describe, expect, test } from "bun:test"
import { Command, type Registry } from "@opencode/plugin/gui"
import { ClientError } from "@opencode/client/promise"
import { pluginDefinition, webPluginError } from "./module"

// One `./gui-experimental` bundle for both processes, as a bundler emits it: requires hoisted to module scope,
// including Electron and Node built-ins that only the main setup uses.
const bundle = `
const sdk = require("@opencode/plugin/gui")
const mainSdk = require("@opencode/plugin/gui/main")
const solid = require("solid-js")
const electron = require("electron")
const fs = require("node:fs")
const app = new electron.BrowserWindow().app.whenReady()
exports.default = sdk.Plugin.define({
  i18n: { en: { title: "Notes" } },
  setup(ctx) {
    const [count] = solid.createSignal(1)
    ctx.add(sdk.Command, { id: "open", title: ctx.t("title") + count(), run() {} })
    return () => ctx.add(sdk.Command, { id: "closed", title: "", run() {} })
  },
  main: () => app.then(() => fs.readFileSync("notes.json")),
})
`

describe("plugin GUIs in a window", () => {
  test("web diagnostics preserve the failure reason without logging module or listing tickets", () => {
    const ticket = "test-ticket"
    const url = `https://example.test/api/experimental/plugin/web-module?id=acme&revision=r1&ticket=${ticket}`
    expect(webPluginError(new TypeError(`Failed to fetch ${url}`), ticket)).toBe(
      "TypeError: Failed to fetch https://example.test/api/experimental/plugin/web-module?id=acme&revision=r1&ticket=[redacted]",
    )
    expect(webPluginError(new SyntaxError("Unexpected token '}'"), ticket)).toBe("SyntaxError: Unexpected token '}'")
    expect(webPluginError(new ClientError("MalformedResponse", { cause: new SyntaxError(ticket) }))).toBe(
      "MalformedResponse",
    )
  })

  test("declare their definition before they start, with the app's module instances and Electron inert", async () => {
    const definition = await pluginDefinition("acme", bundle)
    const added: { readonly registry: Registry<Command>; readonly item: Command }[] = []

    // The host gives the bundle the server plugin's id.
    expect(definition.id).toBe("acme")
    expect(definition.i18n?.en).toEqual({ title: "Notes" })

    const entry = await definition.windowEntry?.()

    const ctx = {
      add: (registry: Registry<Command>, item: Command) => void added.push({ registry, item }),
      t: () => "Notes",
    }

    // SAFETY: the window setup only calls `add` and `t`, which this stand-in context provides.
    const cleanup = entry?.default(ctx as never)

    // The bundle's `Command` is the app's own token, so the host recognizes what it contributes.
    expect(added[0]?.registry).toBe(Command)
    expect(added[0]?.item).toMatchObject({ id: "open", title: "Notes1" })
    // The setup's returned cleanup reaches the host.
    expect(cleanup).toBeFunction()
  })

  test("fail only their own entry when they require a module the app does not share", async () => {
    const definition = await pluginDefinition("acme", 'require("left-pad"); exports.default = { setup() {} }')

    expect(definition.id).toBe("acme")
    await expect(definition.windowEntry?.()).rejects.toThrow("left-pad")
  })
})
