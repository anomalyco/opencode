import { describe, expect, test, beforeEach } from "bun:test"
import { LSPServer } from "../../src/lsp/server"
import { LSP } from "../../src/lsp"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"

describe("DOT LSP integration", () => {
  beforeEach(async () => {
    await Log.init({ print: true })
  })

  test("DOT server has correct configuration", () => {
    expect(LSPServer.Dot).toBeDefined()
    expect(LSPServer.Dot.id).toBe("dot")
    expect(LSPServer.Dot.extensions).toEqual([".dot", ".gv"])
  })

  test("DOT server spawn returns handle when available", async () => {
    const root = process.cwd()
    const handle = await LSPServer.Dot.spawn(root)

    if (!handle) {
      console.log("dot-language-server not available for spawn test (expected if not installed)")
      return
    }

    expect(handle.process).toBeDefined()
    expect(handle.process.pid).toBeGreaterThan(0)

    handle.process.kill()

    await new Promise((resolve) => {
      handle.process.on("exit", resolve)
    })
  })

  test("DOT file is recognized for LSP", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const hasDot = await LSP.hasClients("test.dot")
        expect(hasDot).toBe(true)

        const hasGv = await LSP.hasClients("test.gv")
        expect(hasGv).toBe(true)
      },
    })
  })

  test("DOT server root function returns directory", async () => {
    const root = await LSPServer.Dot.root("test.dot")
    expect(root).toBeDefined()
    expect(typeof root).toBe("string")
  })
})
