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

async function getNotifications(client: any) {
  return (await client.connection.sendRequest("test/get-document-notifications", {})) as Array<{
    method: string
    params: any
  }>
}

describe("LSP buffer sync", () => {
  test("first syncBuffer sends didOpen with buffer text + version", async () => {
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

        await client.notify.open({ path: file, buffer: { text: "const y = 2\n", version: 3 } })

        const notifications = await getNotifications(client)
        const opens = notifications.filter((n) => n.method === "didOpen")
        expect(opens).toHaveLength(1)
        expect(opens[0].params.textDocument.uri).toBe(pathToFileURL(file).href)
        expect(opens[0].params.textDocument.version).toBe(3)
        expect(opens[0].params.textDocument.text).toBe("const y = 2\n")

        await client.shutdown()
      },
    })
  })

  test("second syncBuffer sends incremental didChange with the new version", async () => {
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

        await client.notify.open({ path: file, buffer: { text: "const y = 2\n", version: 1 } })
        await client.notify.open({ path: file, buffer: { text: "const y = 22\n", version: 2 } })

        const notifications = await getNotifications(client)
        const changes = notifications.filter((n) => n.method === "didChange")
        expect(changes).toHaveLength(1)
        expect(changes[0].params.textDocument.version).toBe(2)
        // Incremental change: contentChanges carries a range + the new text.
        expect(changes[0].params.contentChanges[0].range).toBeDefined()
        expect(changes[0].params.contentChanges[0].text).toBe("const y = 22\n")

        await client.shutdown()
      },
    })
  })

  test("stale or duplicate version is ignored (no notification sent)", async () => {
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

        await client.notify.open({ path: file, buffer: { text: "v5\n", version: 5 } })
        // Stale (lower) and duplicate (equal) versions must be ignored.
        const stale = await client.notify.open({ path: file, buffer: { text: "v3\n", version: 3 } })
        const dup = await client.notify.open({ path: file, buffer: { text: "v5again\n", version: 5 } })

        expect(stale).toBe(5)
        expect(dup).toBe(5)

        const notifications = await getNotifications(client)
        expect(notifications.filter((n) => n.method === "didOpen")).toHaveLength(1)
        expect(notifications.filter((n) => n.method === "didChange")).toHaveLength(0)

        await client.shutdown()
      },
    })
  })

  test("closeBuffer sends didClose and clears state", async () => {
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

        await client.notify.open({ path: file, buffer: { text: "const y = 2\n", version: 1 } })
        await client.notify.close({ path: file })

        const notifications = await getNotifications(client)
        const closes = notifications.filter((n) => n.method === "didClose")
        expect(closes).toHaveLength(1)
        expect(closes[0].params.textDocument.uri).toBe(pathToFileURL(file).href)

        // State cleared: reopening with a low version sends didOpen again.
        await client.notify.open({ path: file, buffer: { text: "again\n", version: 0 } })
        const after = await getNotifications(client)
        expect(after.filter((n) => n.method === "didOpen")).toHaveLength(2)

        await client.shutdown()
      },
    })
  })

  test("disk-based notify.open (no buffer) still reads disk + auto-increments", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "test.ts")
    await Bun.write(file, "from-disk-1\n")

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

        const v0 = await client.notify.open({ path: file })
        await Bun.write(file, "from-disk-2\n")
        const v1 = await client.notify.open({ path: file })

        expect(v0).toBe(0)
        expect(v1).toBe(1)

        const notifications = await getNotifications(client)
        const opens = notifications.filter((n) => n.method === "didOpen")
        const changes = notifications.filter((n) => n.method === "didChange")
        expect(opens).toHaveLength(1)
        expect(opens[0].params.textDocument.text).toBe("from-disk-1\n")
        expect(changes).toHaveLength(1)
        expect(changes[0].params.textDocument.version).toBe(1)
        expect(changes[0].params.contentChanges[0].text).toBe("from-disk-2\n")

        await client.shutdown()
      },
    })
  })
})
