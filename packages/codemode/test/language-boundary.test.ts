import { expect, test } from "bun:test"
import { Glob } from "bun"
import path from "node:path"

// The language layer (src/language/) knows nothing about Code Mode (src/codemode/), which is built on it.

test("nothing in the language layer imports Code Mode", async () => {
  const root = path.join(import.meta.dir, "..")
  const src = path.join(root, "src")
  const language = path.join(src, "language")
  const files = await Array.fromAsync(new Glob("**/*.ts").scan({ cwd: language }))
  expect(files.length).toBeGreaterThan(0)
  const outside = []
  for (const file of files) {
    const text = await Bun.file(path.join(language, file)).text()
    for (const match of text.matchAll(/(?:from|import)\s*\(?\s*"(\.[^"]+)"/g)) {
      const target = path.resolve(path.dirname(path.join(language, file)), match[1]!)
      // The package's own files (package.json) are shared; only the rest of src is off limits.
      if (target.startsWith(src + path.sep) && !target.startsWith(language + path.sep)) {
        outside.push(`${file} imports ${match[1]}`)
      }
    }
  }
  expect(outside).toEqual([])
})
