import { expect, test } from "bun:test"
import { MAX_VALUE_DEPTH } from "../src/host.js"
import { Glob } from "bun"
import path from "node:path"
import { Host, Runtime } from "psychoscript"
import { disagreement, FUNCTION, native, scripted, scriptedProgram } from "../script/conformance.js"
import { program } from "../src/index.js"
import { cases } from "./fixtures/wire-cases.js"
import { marker, tree } from "../src/tree.js"

// The wire conformance fixtures: every native host must turn each fixture's program and input into exactly its
// `view`, `handlers`, `canvases` and `result`, or fail as its `error` says. This checks the TypeScript host against
// them, its walk alone against `built`, the prelude building trees itself against the host, and the prelude finding
// handlers by their ids' paths against its own table.
const dir = path.resolve(import.meta.dir, "fixtures/wire")
const files = [...new Glob("*.json").scanSync(dir)].toSorted()

test("there is a fixture for every built-in and every edge case", () => {
  expect(files.length).toBeGreaterThanOrEqual(53)
})

// For every id on the view's nodes and some that are on none: the handler the last prelude's table holds
// (`scriptedProgram`), and the one the prelude finds by following the id's path in the view as built, each as
// `[node, event, value checks]`, where `node` numbers the view's nodes in order (both programs build the same view).
const shapes = `
const __data = __input().data
const __root = view((typeof init === "function" ? init(__data) : undefined) ?? {}, __data)
let __count = 0
const __number = (value) => {
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) return value.forEach(__number)
  value.__node = __count++
  __number(value.children)
}
__number(__root)
const __values = [true, false, -1, 0, 1, 2, 1.5, 100, "a", "b", ["a"], ["a", "z"], null, { kind: "down", x: 1, y: 2, width: 3, height: 4 }]
const __shape = (entry) =>
  entry && typeof entry.event === "string"
    ? [entry.node.__node, entry.event, JSON.stringify(__values.map((value) => __widget_value(entry, value)))]
    : null
`
const handlers = async (source: string, input: { data: unknown }) => {
  const run = async (code: string) => {
    const result = await Runtime.make({
      typedArrays: true,
      limits: { timeoutMs: 60_000, maxValueDepth: MAX_VALUE_DEPTH },
      globals: () => ({ __input: Host.fn(() => input) }),
    }).execute(code)
    if (!result.ok) throw new Error(result.error.message)
    return result.value as ReadonlyArray<[string, unknown]>
  }
  const table = await run(
    scriptedProgram(source) +
      shapes +
      `
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
      return [...__ids].map((id) => [id, __shape(__tree.handlers[id])])`,
  )
  const found = await run(
    program(source) +
      shapes +
      `\nreturn ${JSON.stringify(table.map(([id]) => id))}.map((id) => [id, __shape(__widget_find(__root, id))])`,
  )
  return table.map(([id, shape], index) => [id, shape, found[index]![1]] as const)
}

// A fixture's `built` as the host gets it: markers and non-finite numbers back in place.
const emitted = (value: unknown): unknown =>
  value === FUNCTION
    ? marker
    : value === "$NaN" || value === "$Infinity" || value === "$-Infinity"
      ? Number(value.slice(1))
      : Array.isArray(value)
        ? value.map(emitted)
        : value && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, emitted(item)]))
          : value

const drops = new Set(["function-in-a-prop", "function-as-a-child", "function-in-an-option", "function-as-an-id"])
// Events protocol 1's prelude doesn't know: it can't agree on them.
const newer = new Set([...cases.flatMap((item) => (item.newer ? [item.name] : [])), "builtin-table"])

for (const file of files) {
  test(`wire fixture ${file}`, async () => {
    const fixture = await Bun.file(path.join(dir, file)).json()
    const host = await native(fixture.source, fixture.input)
    for (const field of ["built", "view", "canvases", "result", "error"] as const)
      expect({ field, value: JSON.stringify(host[field]) }).toEqual({ field, value: JSON.stringify(fixture[field]) })
    expect(Object.keys(host.handlers ?? {}).toSorted()).toEqual(Object.keys(fixture.handlers ?? {}).toSorted())
    // The prelude building the tree agrees, but for the functions it leaves out where the host fails.
    const name = file.replace(/\.json$/, "")
    if (!newer.has(name))
      expect(disagreement(await scripted(fixture.source, fixture.input), host, drops.has(name))).toBeUndefined()
  }, 60_000)

  test(`wire fixture ${file}, the walk alone`, async () => {
    const fixture = await Bun.file(path.join(dir, file)).json()
    if (!("built" in fixture)) return
    const walk = () => tree(emitted(fixture.built), "Argument 1 to __widget_emit")
    if (fixture.error) {
      // The run's own failures (the result, a function's position) are the host's, not the walk's.
      if (fixture.error.view) expect(walk).toThrow(fixture.error.message)
      else if (fixture.error.message.includes("contains a function")) expect(walk).toThrow("contains a function")
      return
    }
    const built = walk()
    expect(JSON.stringify(built.view)).toBe(JSON.stringify(fixture.view))
    expect([...built.handlers].toSorted()).toEqual(Object.keys(fixture.handlers).toSorted())
    expect(Object.fromEntries([...built.canvases].map(([key, canvas]) => [key, canvas.id]))).toEqual(fixture.canvases)
  })

  test(`wire fixture ${file}, handlers by path`, async () => {
    const fixture = await Bun.file(path.join(dir, file)).json()
    // Protocol 1's prelude has no handlers for what it doesn't know (a table's).
    if (fixture.error || fixture.input.phase !== "init" || newer.has(file.replace(/\.json$/, ""))) return
    const checked = await handlers(fixture.source, fixture.input)
    for (const [id, table, found] of checked) expect({ id, found }).toEqual({ id, found: table })
    expect(checked.filter(([, table]) => table !== null).length).toBe(Object.keys(fixture.handlers).length)
  }, 60_000)
}
