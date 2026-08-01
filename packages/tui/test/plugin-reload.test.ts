import { writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { expect, test } from "bun:test"
import { freshSpecifier, localSource } from "../src/plugin/discovery"
import { tmpdir } from "./fixture/fixture"

test("localSource resolves file URLs and local paths but not package specs", () => {
  const base = process.cwd()
  const absolute = path.resolve(base, "abs", "plugin.ts")
  expect(localSource("file:///tmp/plugin.ts", base)?.href).toBe("file:///tmp/plugin.ts")
  expect(localSource("./plugin.ts", base)?.href).toBe(pathToFileURL(path.join(base, "plugin.ts")).href)
  expect(localSource("../plugin.ts", path.join(base, "nested"))?.href).toBe(
    pathToFileURL(path.join(base, "plugin.ts")).href,
  )
  expect(localSource(absolute, base)?.href).toBe(pathToFileURL(absolute).href)
  expect(localSource("some-package", base)).toBeUndefined()
  expect(localSource("@scope/some-package", base)).toBeUndefined()
})

test("freshSpecifier re-imports a plugin source after it changes", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "plugin.ts")
  await writeFile(file, "export default 1")
  const first: { readonly default?: unknown } = await import(freshSpecifier(pathToFileURL(file).href, 1))
  await writeFile(file, "export default 2")
  const second: { readonly default?: unknown } = await import(freshSpecifier(pathToFileURL(file).href, 2))
  expect(first.default).toBe(1)
  expect(second.default).toBe(2)
})
