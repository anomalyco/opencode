import { describe, expect, test } from "bun:test"
import path from "path"
import { Module } from "@opencode-ai/util/module"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

describe("util.module", () => {
  test("resolves package subpaths from the provided dir", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "proj")
    const file = path.join(root, "node_modules/typescript/lib/tsserver.js")
    await Filesystem.write(file, "export {}\n")
    await Filesystem.writeJson(path.join(root, "node_modules/typescript/package.json"), { name: "typescript" })

    expect(Module.resolve("typescript/lib/tsserver.js", root)).toBe(file)
  })

  test("resolves packages through ancestor node_modules", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "proj")
    const cwd = path.join(root, "apps/web")
    const file = path.join(root, "node_modules/eslint/lib/api.js")
    await Filesystem.write(file, "export {}\n")
    await Filesystem.writeJson(path.join(root, "node_modules/eslint/package.json"), {
      name: "eslint",
      main: "lib/api.js",
    })
    await Filesystem.write(path.join(cwd, ".keep"), "")

    expect(Module.resolve("eslint", cwd)).toBe(file)
  })

  test("resolves relative to the provided dir", async () => {
    await using tmp = await tmpdir()
    const a = path.join(tmp.path, "a")
    const b = path.join(tmp.path, "b")
    const left = path.join(a, "node_modules/biome/index.js")
    const right = path.join(b, "node_modules/biome/index.js")
    await Filesystem.write(left, "export {}\n")
    await Filesystem.write(right, "export {}\n")
    await Filesystem.writeJson(path.join(a, "node_modules/biome/package.json"), {
      name: "biome",
      main: "index.js",
    })
    await Filesystem.writeJson(path.join(b, "node_modules/biome/package.json"), {
      name: "biome",
      main: "index.js",
    })

    expect(Module.resolve("biome", a)).toBe(left)
    expect(Module.resolve("biome", b)).toBe(right)
    expect(Module.resolve("biome", a)).not.toBe(Module.resolve("biome", b))
  })

  test("returns undefined when resolution fails", async () => {
    await using tmp = await tmpdir()
    expect(Module.resolve("missing-package", tmp.path)).toBeUndefined()
  })
})
