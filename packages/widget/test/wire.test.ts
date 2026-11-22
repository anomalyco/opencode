import { expect, test } from "bun:test"
import { Glob } from "bun"
import path from "node:path"
import { record } from "../script/conformance.js"

// The wire conformance fixtures: every host that builds view trees must turn each fixture's program and input into
// exactly its `view`, `handlers` and `canvases`. This checks the TypeScript runtime.
const dir = path.resolve(import.meta.dir, "fixtures/wire")
const files = [...new Glob("*.json").scanSync(dir)].toSorted()

test("there is a fixture for every built-in and every edge case", () => {
  expect(files.length).toBeGreaterThanOrEqual(34)
})

for (const file of files) {
  test(`wire fixture ${file}`, async () => {
    const fixture = await Bun.file(path.join(dir, file)).json()
    const actual = await record(fixture.source, fixture.input)
    expect(JSON.stringify(actual.view)).toBe(JSON.stringify(fixture.view))
    expect(actual.handlers).toEqual(fixture.handlers)
    expect(actual.canvases).toEqual(fixture.canvases)
  })
}
