import { afterEach, expect, test } from "bun:test"
import path from "node:path"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

test("POST and GET /mcp retain tool discovery errors and accept an empty catalog", async () => {
  await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
  const listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })
  const headers = { "content-type": "application/json", "x-opencode-directory": tmp.path }
  const fixture = path.join(import.meta.dir, "../fixture/mcp-lifecycle-stdio.ts")
  try {
    const broken = await fetch(new URL("/mcp", listener.url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "broken",
        config: { type: "local", command: [process.execPath, fixture, "--tools-error"] },
      }),
    })
    expect(broken.status).toBe(200)
    const failure = { status: "failed", error: expect.stringContaining("fixture tool catalog unavailable") }
    expect(await broken.json()).toMatchObject({ broken: failure })

    const empty = await fetch(new URL("/mcp", listener.url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "empty",
        config: { type: "local", command: [process.execPath, fixture, "--empty-tools"] },
      }),
    })
    expect(empty.status).toBe(200)
    expect(await empty.json()).toMatchObject({ empty: { status: "connected" } })

    const readback = await fetch(new URL("/mcp", listener.url), { headers })
    expect(readback.status).toBe(200)
    expect(await readback.json()).toMatchObject({ broken: failure, empty: { status: "connected" } })
  } finally {
    await listener.stop(true)
  }
}, 30_000)
