import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import * as Lsp from "../../src/lsp/index"
import * as launch from "../../src/lsp/launch"
import { LSPServer } from "../../src/lsp/server"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("lsp.spawn", () => {
  test("does not spawn builtin LSP for files outside instance", async () => {
    await using tmp = await tmpdir()
    const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Lsp.LSP.touchFile(path.join(tmp.path, "..", "outside.ts"))
          await Lsp.LSP.hover({
            file: path.join(tmp.path, "..", "hover.ts"),
            line: 0,
            character: 0,
          })
        },
      })

      expect(spy).toHaveBeenCalledTimes(0)
    } finally {
      spy.mockRestore()
      await Instance.disposeAll()
    }
  })

  test("would spawn builtin LSP for files inside instance", async () => {
    await using tmp = await tmpdir()
    const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Lsp.LSP.hover({
            file: path.join(tmp.path, "src", "inside.ts"),
            line: 0,
            character: 0,
          })
        },
      })

      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
      await Instance.disposeAll()
    }
  })

  test("spawns builtin Typescript LSP with correct arguments", async () => {
    await using tmp = await tmpdir()

    // Create dummy tsserver to satisfy Module.resolve
    const tsdk = path.join(tmp.path, "node_modules", "typescript", "lib")
    await fs.mkdir(tsdk, { recursive: true })
    await fs.writeFile(path.join(tsdk, "tsserver.js"), "")

    const spawnSpy = spyOn(launch, "spawn").mockImplementation(
      () =>
        ({
          stdin: {},
          stdout: {},
          stderr: {},
          on: () => {},
          kill: () => {},
        }) as any,
    )

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await LSPServer.Typescript.spawn(tmp.path)
        },
      })

      expect(spawnSpy).toHaveBeenCalled()
      const args = spawnSpy.mock.calls[0][1] as string[]

      expect(args).toContain("--tsserver-path")
      expect(args).toContain("--tsserver-log-verbosity")
      expect(args).toContain("off")
    } finally {
      spawnSpy.mockRestore()
    }
  })

  test("spawns builtin Typescript LSP with --ignore-node-modules if no config is found", async () => {
    await using tmp = await tmpdir()

    // Create dummy tsserver to satisfy Module.resolve
    const tsdk = path.join(tmp.path, "node_modules", "typescript", "lib")
    await fs.mkdir(tsdk, { recursive: true })
    await fs.writeFile(path.join(tsdk, "tsserver.js"), "")

    // NO tsconfig.json or jsconfig.json created here

    const spawnSpy = spyOn(launch, "spawn").mockImplementation(
      () =>
        ({
          stdin: {},
          stdout: {},
          stderr: {},
          on: () => {},
          kill: () => {},
        }) as any,
    )

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await LSPServer.Typescript.spawn(tmp.path)
        },
      })

      expect(spawnSpy).toHaveBeenCalled()
      const args = spawnSpy.mock.calls[0][1] as string[]

      expect(args).toContain("--ignore-node-modules")
    } finally {
      spawnSpy.mockRestore()
    }
  })
})
