import { expect, test } from "bun:test"
import path from "node:path"
import { parse } from "jsonc-parser"
import { removePluginConfig } from "../src/commands/handlers/plugin/remove"
import { tmpdir } from "./fixture/tmpdir"

test("removes string and object package entries without replacing unrelated settings", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "opencode.jsonc")
  await Bun.write(
    file,
    '{\n  // retained\n  "model": "provider/model",\n  "plugins": ["remove-me", { "package": "remove-me", "options": {} }, "keep-me"]\n}\n',
  )

  expect(await removePluginConfig(file, "remove-me")).toBe(true)
  expect(await removePluginConfig(file, "remove-me")).toBe(false)
  const text = await Bun.file(file).text()
  expect(text).toContain("// retained")
  expect(parse(text)).toEqual({ model: "provider/model", plugins: ["keep-me"] })
})
