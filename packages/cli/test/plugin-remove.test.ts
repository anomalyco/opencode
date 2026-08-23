import { expect, test } from "bun:test"
import path from "node:path"
import { parse } from "jsonc-parser"
import { removePluginConfig } from "../src/commands/handlers/plugin/remove"

test("removes string and object package entries without replacing unrelated settings", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  const file = path.join(directory, "opencode.jsonc")
  await Bun.write(
    file,
    '{\n  // retained\n  "model": "provider/model",\n  "plugins": ["remove-me", { "package": "remove-me", "options": {} }, "keep-me"]\n}\n',
  )

  try {
    expect(await removePluginConfig(file, "remove-me")).toBe(true)
    expect(await removePluginConfig(file, "remove-me")).toBe(false)
    const text = await Bun.file(file).text()
    expect(text).toContain("// retained")
    expect(parse(text)).toEqual({ model: "provider/model", plugins: ["keep-me"] })
  } finally {
    await Bun.$`rm -rf ${directory}`
  }
})
