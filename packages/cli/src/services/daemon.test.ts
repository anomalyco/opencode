import { afterEach, describe, expect, test } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Daemon } from "./daemon"

const stateFile = path.join(Global.Path.state, "server.json")
const passwordFile = path.join(Global.Path.state, "password")

const daemonLayer = Daemon.layer.pipe(Layer.provide(NodeFileSystem.layer))
const runDaemon = <A, E>(effect: Effect.Effect<A, E, Daemon.Service>) => Effect.runPromise(effect.pipe(Effect.provide(daemonLayer)))

afterEach(async () => {
  await Promise.all([Bun.file(stateFile).delete().catch(() => {}), Bun.file(passwordFile).delete().catch(() => {})])
})

describe("Daemon.status", () => {
  test("reports a healthy daemon even when its version differs from the client", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ healthy: true })
      },
    })
    try {
      await Bun.write(passwordFile, "test-password")
      await Bun.write(
        stateFile,
        JSON.stringify({ id: "daemon-test", version: "0.0.0-old", url: server.url.origin, pid: process.pid }),
      )

      expect(await runDaemon(Daemon.Service.use((daemon) => daemon.status()))).toBe(server.url.origin)
    } finally {
      await server.stop(true)
    }
  })
})
