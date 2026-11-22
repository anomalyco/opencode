import { expect, test } from "bun:test"
import { Glob } from "bun"
import path from "node:path"
import { Runtime } from "psychoscript"
import { built, FUNCTION, record } from "../script/conformance.js"
import { program } from "../src/index.js"
import { nativeTree } from "./native-tree.js"

// The wire conformance fixtures: every host that builds view trees must turn each fixture's program and input into
// exactly its `view`, `handlers` and `canvases`. This checks the TypeScript runtime, which builds them in the prelude,
// and native mode: the prelude's view as built (`built`), the walk of `native-tree.ts` over it, and the prelude finding
// handlers by their ids' paths.
const dir = path.resolve(import.meta.dir, "fixtures/wire")
const files = [...new Glob("*.json").scanSync(dir)].toSorted()

test("there is a fixture for every built-in and every edge case", () => {
  expect(files.length).toBeGreaterThanOrEqual(36)
})

// For every id on the view's nodes and some that are on none: what the prelude's handler table holds, and what it
// finds by the id's path in the view as built, as `[id, event, value checks]` (the same handler or none).
const handlers = async (source: string, input: { data: unknown }) => {
  const result = await Runtime.make({ limits: { timeoutMs: 60_000 } }).execute(
    program(source) +
      `
      const __data = ${JSON.stringify(input.data)}
      const __root = view((typeof init === "function" ? init(__data) : undefined) ?? {}, __data)
      const __tree = __widget_tree(__root)
      const __ids = new Set(Object.keys(__tree.handlers))
      const __collect = (node) => {
        if (!node || typeof node !== "object") return
        if (Array.isArray(node)) return node.forEach(__collect)
        if (typeof node.id === "string") {
          // Ids next to real ones, for the first nodes (the grid has 400 ids, and each lookup scans 200 siblings).
          if (__ids.size < 60) __ids.add(node.id + "/0").add(node.id + "~2")
          __ids.add(node.id)
        }
        __collect(node.children)
      }
      __collect(__tree.view)
      ;["", "0/", "/0", "1", "x", "constructor", "__proto__", "toString", "0/999", "0/0.0", ":"].forEach((id) => __ids.add(id))
      const __values = [true, false, -1, 0, 1, 2, 1.5, 100, "a", "b", ["a"], ["a", "z"], null, { kind: "down", x: 1, y: 2, width: 3, height: 4 }]
      const __shape = (entry) =>
        entry && typeof entry.event === "string"
          ? [entry.event, JSON.stringify(__values.map((value) => __widget_value(entry, value)))]
          : null
      return [...__ids].map((id) => {
        const table = __tree.handlers[id]
        const found = __widget_find(__root, id)
        const same = table && typeof table.event === "string" ? found !== undefined && found.handler === table.handler : found === undefined
        return [id, same, __shape(table), __shape(found)]
      })`,
  )
  if (!result.ok) throw new Error(result.error.message)
  return result.value as ReadonlyArray<[string, boolean, unknown, unknown]>
}

for (const file of files) {
  test(`wire fixture ${file}`, async () => {
    const fixture = await Bun.file(path.join(dir, file)).json()
    const actual = await record(fixture.source, fixture.input)
    expect(JSON.stringify(actual.view)).toBe(JSON.stringify(fixture.view))
    expect(actual.handlers).toEqual(fixture.handlers)
    expect(actual.canvases).toEqual(fixture.canvases)
  })

  test(`wire fixture ${file}, native mode`, async () => {
    const fixture = await Bun.file(path.join(dir, file)).json()
    expect(JSON.stringify(await built(fixture.source, fixture.input))).toBe(JSON.stringify(fixture.built))
    const tree = nativeTree(fixture.built, (value) => value === FUNCTION)
    // A marker left anywhere else goes as a function does in a step output: left out, or null in an array.
    expect(JSON.stringify(tree.view, (_, value) => (value === FUNCTION ? undefined : value))).toBe(
      JSON.stringify(fixture.view),
    )
    expect(tree.handlers).toEqual(fixture.handlers)
    expect(Object.fromEntries(Object.entries(tree.canvases).map(([key, canvas]) => [key, canvas.id]))).toEqual(
      fixture.canvases,
    )
    for (const [id, same, table, found] of await handlers(fixture.source, fixture.input)) {
      expect({ id, same }).toEqual({ id, same: true })
      expect({ id, found }).toEqual({ id, found: table })
    }
  }, 60_000)
}
