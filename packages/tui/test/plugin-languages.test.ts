import { expect, test } from "bun:test"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { LanguageDefinition } from "@opencode/plugin/tui/context"
import { createPluginContext, type Dispose, type Registry, type usePluginHost } from "../src/plugin/api"

const elm = {
  id: "elm",
  extensions: [".elm"],
  aliases: ["elm-lang"],
  wasm: "https://example.com/tree-sitter-elm.wasm",
  highlights: ["https://example.com/highlights.scm"],
  injectionMapping: { infoStringMap: { elm: "elm" } },
}

function setup() {
  const registered = new Map<string, unknown>()
  const owned: Dispose[] = []
  const host = {
    app: { version: "test", channel: "test" },
    client: { api: {} },
    keymap: {},
    shortcuts: {},
    keymapState: {},
    sessionTabs: {},
  } as unknown as ReturnType<typeof usePluginHost>
  const registry: Registry = {
    has: (kind, name) => registered.has(`${kind}:${name}`),
    set(kind: string, name: string, value: unknown) {
      registered.set(`${kind}:${name}`, value)
    },
    remove: (kind, name) => registered.delete(`${kind}:${name}`),
    active: () => true,
  }
  const context = createPluginContext({ host, id: "test", options: undefined, owned, registry })
  return { registered, owned, languages: context.languages }
}

test("registers a language with plugin file URLs resolved to paths", () => {
  const harness = setup()
  const wasm = path.resolve("plugin", "tree-sitter-elm.wasm")
  const unregister = harness.languages.register({ ...elm, wasm: pathToFileURL(wasm).href })
  expect(harness.registered.get("languages:elm")).toEqual({ ...elm, wasm })
  expect(() => harness.languages.register(elm)).toThrow("Language already registered: elm")

  unregister()
  expect(harness.registered.has("languages:elm")).toBe(false)
})

test("unregisters a language when the plugin deactivates", async () => {
  const harness = setup()
  harness.languages.register(elm)
  await Promise.all(harness.owned.map((dispose) => dispose()))
  expect(harness.registered.has("languages:elm")).toBe(false)
})

test.each<[string, LanguageDefinition]>([
  ["an empty ID", { ...elm, id: "" }],
  ["an extension without a dot", { ...elm, extensions: ["elm"] }],
  ["no highlight queries", { ...elm, highlights: [] }],
  ["a relative path", { ...elm, wasm: "./tree-sitter-elm.wasm" }],
])("rejects %s", (_, definition) => {
  const harness = setup()
  expect(() => harness.languages.register(definition)).toThrow()
  expect(harness.registered.size).toBe(0)
})
