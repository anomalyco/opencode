import { expect, test } from "bun:test"
import path from "node:path"
import { evaluateMain } from "./module"

// One `./gui-experimental` bundle for both processes, as Vite emits it with vite-plugin-solid: Solid's templates and
// event delegation run at module scope, beside the Node built-ins only the main setup uses.
const bundle = `
const web = require("solid-js/web")
const path = require("node:path")
const sdk = require("@opencode/plugin/gui")
const tmpl = web.template("<p>Notes</p>")
web.delegateEvents(["click"])
exports.default = sdk.Plugin.define({
  setup: () => void tmpl(),
  main: () => () => path.join("a", "b"),
})
`

test("main runs a plugin's main setup, with the window-only modules inert and Node built-ins real", async () => {
  const loaded = await evaluateMain(bundle)

  // SAFETY: the main setup reads no context; it returns a cleanup that uses a real Node built-in.
  const cleanup = await loaded.setup({} as never)

  expect(cleanup?.()).toBe(path.join("a", "b"))
})

test("main runs nothing for a plugin with only a window setup", async () => {
  const loaded = await evaluateMain(
    'const web = require("solid-js/web"); exports.default = { setup: () => void web.template("<p>")() }',
  )

  // SAFETY: the empty setup reads no context.
  expect(await loaded.setup({} as never)).toBeUndefined()
})
