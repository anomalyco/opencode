import { expect, test } from "bun:test"
import path from "node:path"
import { parse } from "jsonc-parser"
import { configurationTarget, writePluginConfig } from "../src/commands/handlers/plugin/add"
import { tmpdir } from "./fixture/tmpdir"

test("routes packages according to their exported runtimes", () => {
  expect(configurationTarget("server.js", "tui.js")).toBe("server")
  expect(configurationTarget("server.js", undefined)).toBe("server")
  expect(configurationTarget(undefined, "tui.js")).toBe("tui")
  expect(configurationTarget(undefined, undefined)).toBeUndefined()
})

test("adds a package to global plugin config without replacing unrelated settings", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "opencode.jsonc")
  await Bun.write(file, '{\n  // retained\n  "model": "provider/model",\n  "plugins": ["first"]\n}\n')

  expect(await writePluginConfig(file, "second@1.0.0")).toBe(true)
  expect(await writePluginConfig(file, "second@1.0.0")).toBe(false)
  const text = await Bun.file(file).text()
  expect(text).toContain("// retained")
  expect(parse(text)).toEqual({
    model: "provider/model",
    plugins: ["first", "second@1.0.0"],
  })
})
