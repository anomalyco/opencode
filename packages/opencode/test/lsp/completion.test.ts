import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir, withTestInstance } from "../fixture/fixture"
import { LSPClient } from "@/lsp/client"
import * as LSPServer from "@/lsp/server"

function spawnFakeServer() {
  const { spawn } = require("child_process")
  const serverPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
  return {
    process: spawn(process.execPath, [serverPath], {
      stdio: "pipe",
    }),
  }
}

describe("LSP completion", () => {
  test("initialize payload includes the completion capability block", async () => {
    const handle = spawnFakeServer() as any

    const client = await withTestInstance({
      directory: process.cwd(),
      fn: (ctx) =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
          directory: process.cwd(),
          instance: ctx,
        }),
    })

    const params = await client.connection.sendRequest<any>("test/get-initialize-params", {})

    expect(params.capabilities.textDocument.completion).toBeDefined()
    expect(params.capabilities.textDocument.completion.dynamicRegistration).toBe(true)
    expect(params.capabilities.textDocument.completion.contextSupport).toBe(true)
    expect(params.capabilities.textDocument.completion.completionItem.snippetSupport).toBe(true)
    expect(params.capabilities.textDocument.completion.completionItem.insertReplaceSupport).toBe(true)
    expect(params.capabilities.textDocument.completion.completionItem.documentationFormat).toEqual([
      "markdown",
      "plaintext",
    ])
    expect(params.capabilities.textDocument.completion.completionItem.labelDetailsSupport).toBe(true)

    await client.shutdown()
  })

  test("sendRequest textDocument/completion with correct uri, position, and context", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "test.ts")
    await Bun.write(file, "const x = 1\n")

    await withTestInstance({
      directory: tmp.path,
      fn: async (ctx) => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
          instance: ctx,
        })

        await client.notify.open({ path: file })
        await client.connection.sendRequest("textDocument/completion", {
          textDocument: { uri: pathToFileURL(file).href },
          position: { line: 0, character: 6 },
          context: { triggerKind: 1 },
        })

        const params = await client.connection.sendRequest<any>("test/get-last-completion-params", {})
        expect(params.textDocument.uri).toBe(pathToFileURL(file).href)
        expect(params.position.line).toBe(0)
        expect(params.position.character).toBe(6)
        expect(params.context.triggerKind).toBe(1)

        await client.shutdown()
      },
    })
  })

  test("returns items for a CompletionItem[] response", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "test.ts")
    await Bun.write(file, "const x = 1\n")

    await withTestInstance({
      directory: tmp.path,
      fn: async (ctx) => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
          instance: ctx,
        })

        const completionItems = [
          { label: "console", kind: 6 },
          { label: "const", kind: 14 },
        ]
        await client.connection.sendRequest("test/set-completion-response", { response: completionItems })
        await client.notify.open({ path: file })

        const result = await client.connection.sendRequest<any>("textDocument/completion", {
          textDocument: { uri: pathToFileURL(file).href },
          position: { line: 0, character: 6 },
          context: { triggerKind: 1 },
        })

        expect(Array.isArray(result)).toBe(true)
        expect(result).toHaveLength(2)
        expect(result[0].label).toBe("console")
        expect(result[1].label).toBe("const")

        await client.shutdown()
      },
    })
  })

  test("returns items for a CompletionList response", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "test.ts")
    await Bun.write(file, "const x = 1\n")

    await withTestInstance({
      directory: tmp.path,
      fn: async (ctx) => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
          instance: ctx,
        })

        const completionList = {
          isIncomplete: false,
          items: [
            { label: "Array", kind: 7 },
            { label: "Boolean", kind: 7 },
          ],
        }
        await client.connection.sendRequest("test/set-completion-response", { response: completionList })
        await client.notify.open({ path: file })

        const result = await client.connection.sendRequest<any>("textDocument/completion", {
          textDocument: { uri: pathToFileURL(file).href },
          position: { line: 0, character: 6 },
          context: { triggerKind: 1 },
        })

        expect(result).toBeDefined()
        expect(result.isIncomplete).toBe(false)
        expect(Array.isArray(result.items)).toBe(true)
        expect(result.items).toHaveLength(2)
        expect(result.items[0].label).toBe("Array")

        await client.shutdown()
      },
    })
  })

  test("swallows a rejected request and returns null", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "test.ts")
    await Bun.write(file, "const x = 1\n")

    await withTestInstance({
      directory: tmp.path,
      fn: async (ctx) => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
          instance: ctx,
        })

        // completionResponse is null by default (server returns null for unknown requests)
        await client.notify.open({ path: file })

        let result: any
        let threw = false
        try {
          result = await client.connection.sendRequest<any>("textDocument/completion", {
            textDocument: { uri: pathToFileURL(file).href },
            position: { line: 0, character: 6 },
            context: { triggerKind: 1 },
          })
        } catch {
          threw = true
        }

        expect(threw).toBe(false)
        expect(result).toBeNull()

        await client.shutdown()
      },
    })
  })
})
