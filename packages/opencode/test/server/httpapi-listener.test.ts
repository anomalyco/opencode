import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { HttpApiListener } from "../../src/server/httpapi-listener"
import { PtyPaths } from "../../src/server/routes/instance/httpapi/groups/pty"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const testPty = process.platform === "win32" ? test.skip : test

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await disposeAllInstances()
  await resetDatabase()
})

async function startListener() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  return HttpApiListener.listen({ hostname: "127.0.0.1", port: 0 })
}

describe("native HttpApi listener", () => {
  test("serves HTTP routes via the HttpApi web handler", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const listener = await startListener()
    try {
      const response = await fetch(`${listener.url.origin}${PtyPaths.shells}`, {
        headers: { "x-opencode-directory": tmp.path },
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(Array.isArray(body)).toBe(true)
      expect(body[0]).toMatchObject({
        path: expect.any(String),
        name: expect.any(String),
        acceptable: expect.any(Boolean),
      })
    } finally {
      await listener.stop(true)
    }
  })

  testPty("PTY websocket connect echoes input back to the client", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const listener = await startListener()
    try {
      const created = await fetch(`${listener.url.origin}${PtyPaths.create}`, {
        method: "POST",
        headers: {
          "x-opencode-directory": tmp.path,
          "content-type": "application/json",
        },
        body: JSON.stringify({ command: "/bin/cat", title: "listener-smoke" }),
      })
      expect(created.status).toBe(200)
      const info = (await created.json()) as { id: string }

      try {
        const wsURL = new URL(PtyPaths.connect.replace(":ptyID", info.id), listener.url)
        wsURL.protocol = "ws:"
        wsURL.searchParams.set("directory", tmp.path)
        wsURL.searchParams.set("cursor", "-1")

        const messages: string[] = []
        const ws = new WebSocket(wsURL)
        ws.binaryType = "arraybuffer"

        const opened = new Promise<void>((resolve, reject) => {
          ws.addEventListener("open", () => resolve(), { once: true })
          ws.addEventListener("error", () => reject(new Error("ws error before open")), { once: true })
        })

        const closed = new Promise<void>((resolve) => {
          ws.addEventListener("close", () => resolve(), { once: true })
        })

        ws.addEventListener("message", (event) => {
          const data = event.data
          messages.push(typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer))
        })

        await opened
        ws.send("ping-listener\n")

        const start = Date.now()
        while (!messages.some((m) => m.includes("ping-listener")) && Date.now() - start < 5_000) {
          await new Promise((r) => setTimeout(r, 50))
        }
        ws.close(1000, "done")

        expect(messages.some((m) => m.includes("ping-listener"))).toBe(true)
        // Verify close event fires (handler.onClose path runs and the
        // Bun.serve websocket lifecycle reaches close).
        await closed
        expect(ws.readyState).toBe(WebSocket.CLOSED)
      } finally {
        await fetch(`${listener.url.origin}${PtyPaths.remove.replace(":ptyID", info.id)}`, {
          method: "DELETE",
          headers: { "x-opencode-directory": tmp.path },
        }).catch(() => undefined)
      }
    } finally {
      await listener.stop(true)
    }
  })
})
