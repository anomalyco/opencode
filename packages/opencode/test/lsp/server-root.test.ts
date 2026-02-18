import { describe, expect, test } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
import { LSPServer } from "../../src/lsp/server"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("lsp.server roots", () => {
  test("jdtls prefers settings.gradle root", async () => {
    await using tmp = await tmpdir()
    const root = tmp.path
    const module = path.join(root, "services/api")
    const file = path.join(module, "src/main/java/App.java")

    await fs.mkdir(path.dirname(file), { recursive: true })
    await Bun.write(path.join(root, "settings.gradle.kts"), "")
    await Bun.write(path.join(module, "build.gradle.kts"), "")
    await Bun.write(file, "class App {}")

    const result = await Instance.provide({
      directory: root,
      fn: () => LSPServer.JDTLS.root(file),
    })

    expect(result).toBe(root)
  })

  test("jdtls uses gradle wrapper root when settings is missing", async () => {
    await using tmp = await tmpdir()
    const root = tmp.path
    const module = path.join(root, "services/api")
    const file = path.join(module, "src/main/java/App.java")

    await fs.mkdir(path.dirname(file), { recursive: true })
    await Bun.write(path.join(root, "gradlew"), "")
    await Bun.write(path.join(module, "build.gradle.kts"), "")
    await Bun.write(file, "class App {}")

    const result = await Instance.provide({
      directory: root,
      fn: () => LSPServer.JDTLS.root(file),
    })

    expect(result).toBe(root)
  })

  test("jdtls falls back to nearest build file", async () => {
    await using tmp = await tmpdir()
    const root = tmp.path
    const module = path.join(root, "services/api")
    const file = path.join(module, "src/main/java/App.java")

    await fs.mkdir(path.dirname(file), { recursive: true })
    await Bun.write(path.join(module, "build.gradle.kts"), "")
    await Bun.write(file, "class App {}")

    const result = await Instance.provide({
      directory: root,
      fn: () => LSPServer.JDTLS.root(file),
    })

    expect(result).toBe(module)
  })
})
