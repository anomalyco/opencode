import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import * as Lsp from "../../src/lsp/index"
import * as launch from "../../src/lsp/launch"
import { LSPServer } from "../../src/lsp/server"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Npm } from "../../src/npm"

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

    // Mock Npm.which to return a fake path for typescript-language-server
    const npmWhichSpy = spyOn(Npm, "which").mockImplementation(async (pkg) => {
      if (pkg === "typescript-language-server") return path.join(tmp.path, "fake-tsls")
      return undefined
    })

    let capturedInitialization: Record<string, any> | undefined
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
          const result = await LSPServer.Typescript.spawn(tmp.path)
          capturedInitialization = result?.initialization
        },
      })

      expect(spawnSpy).toHaveBeenCalled()
      const args = spawnSpy.mock.calls[0][1] as string[]

      expect(args).toEqual(["--stdio"])
      expect(capturedInitialization?.tsserver?.path).toBeDefined()
      expect(capturedInitialization?.tsserver?.logVerbosity).toBe("off")
    } finally {
      spawnSpy.mockRestore()
      npmWhichSpy.mockRestore()
    }
  })

  test("spawns builtin Typescript LSP with --stdio regardless of config presence", async () => {
    await using tmp = await tmpdir()

    // Create dummy tsserver to satisfy Module.resolve
    const tsdk = path.join(tmp.path, "node_modules", "typescript", "lib")
    await fs.mkdir(tsdk, { recursive: true })
    await fs.writeFile(path.join(tsdk, "tsserver.js"), "")

    // Mock Npm.which to return a fake path for typescript-language-server
    const npmWhichSpy = spyOn(Npm, "which").mockImplementation(async (pkg) => {
      if (pkg === "typescript-language-server") return path.join(tmp.path, "fake-tsls")
      return undefined
    })

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

      expect(args).toEqual(["--stdio"])
    } finally {
      spawnSpy.mockRestore()
      npmWhichSpy.mockRestore()
    }
  })
})
