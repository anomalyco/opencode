import { expect, test } from "bun:test"
import path from "node:path"

test("review and file viewers use only public renderer capabilities", async () => {
  const root = path.join(import.meta.dir, "../src")
  const files = await Array.fromAsync(new Bun.Glob("**/*.{ts,tsx}").scan(root))
  const sources = await Promise.all(files.map(async (file) => ({ file, source: await Bun.file(path.join(root, file)).text() })))
  expect(sources.filter(({ source }) => /["'](?:@\/|@opencode\/(?:app|desktop|core|server)(?:[\/"']))/.test(source)).map(({ file }) => file)).toEqual([])
})
