import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

test("browser diff parsers are isolated from render components", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const files: string[] = []
  for await (const file of new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: root, absolute: true })) {
    if (file.endsWith("session-diff.ts")) continue
    if (file.endsWith("worker.ts")) continue
    if (file.endsWith(".test.ts")) continue
    const text = await Bun.file(file).text()
    if (/\b(?:parseDiffFromFile|parsePatchFiles|parsePatch)\b/.test(text)) files.push(file.slice(root.length))
  }
  expect(files).toEqual([])
})
