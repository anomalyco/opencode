import { expect, test } from "bun:test"
import path from "node:path"
import { BrowserDesktop } from "../src/rpc"
import { Schema } from "effect"

test("the browser companion has no imports from host application or server internals", async () => {
  const root = path.join(import.meta.dir, "../src")
  const files = await Array.fromAsync(new Bun.Glob("**/*.{ts,tsx}").scan(root))
  const imports = await Promise.all(
    files.map(async (file) => ({ file, source: await Bun.file(path.join(root, file)).text() })),
  )
  expect(
    imports
      .filter(({ source }) => /["']@opencode\/(?:app|desktop|core|server)(?:[\/"'])/.test(source))
      .map(({ file }) => file),
  ).toEqual([])
})

test("the public local contract loads without Electron and validates its inventory", () => {
  expect(BrowserDesktop.Definition.id).toBe("browser.desktop")
  const decode = Schema.decodeUnknownSync(BrowserDesktop.Event)
  expect(decode({ type: "state", state: { tabs: [], focusedTabID: null }, surfaces: {} }).type).toBe("state")
  expect(() => decode({ type: "focus", tabID: "wrong-owner" })).toThrow()
})
