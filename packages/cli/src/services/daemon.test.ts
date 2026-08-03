import { afterEach, describe, expect, test } from "bun:test"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Global } from "@opencode-ai/core/global"
import { Effect } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Daemon } from "./daemon"

const originalState = Global.Path.state

afterEach(() => {
  ;(Global.Path as { state: string }).state = originalState
})

describe("Daemon.status", () => {
  test("reports a healthy daemon even when its version differs from the client", async () => {
    const state = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-daemon-status-"))
    ;(Global.Path as { state: string }).state = state

    using server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ healthy: true, version: "older-version", pid: process.pid })
      },
    })
    const url = server.url.origin
    await fs.writeFile(
      path.join(state, "server.json"),
      JSON.stringify({ id: "test", version: "older-version", url, pid: process.pid }),
    )

    const status = await Effect.runPromise(
      Daemon.Service.use((daemon) => daemon.status()).pipe(
        Effect.provide(Daemon.layer),
        Effect.provide(NodeServices.layer),
        Effect.scoped,
      ),
    )

    expect(status).toBe(url)
  })
})
