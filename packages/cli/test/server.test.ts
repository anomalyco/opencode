import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Server } from "../src/services/server"
import { ServiceConfig } from "../src/services/service-config"

test("managed resolution keeps lifecycle operations Effect-native", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-server-resolution-"))
  const id = "server-resolution-test"
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({
        healthy: true,
        version: InstallationVersion,
        pid: process.pid,
        instanceID: id,
        status: { type: "ready" },
      })
    },
  })
  const registration = path.join(root, "state", ServiceConfig.filename())

  try {
    await fs.mkdir(path.dirname(registration), { recursive: true })
    await fs.writeFile(
      registration,
      JSON.stringify({
        id,
        version: InstallationVersion,
        url: server.url.toString(),
        pid: process.pid,
      }),
    )
    const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
    const resolved = await Effect.runPromise(
      Server.resolve({}).pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer), Effect.scoped),
    )

    expect(resolved.endpoint.url).toBe(server.url.toString())
    expect(resolved.reconnect).toBeFunction()
    expect(Effect.isEffect(resolved.restart)).toBe(true)
    if (!resolved.reconnect) throw new Error("Expected managed reconnect")
    expect(await Effect.runPromise(resolved.reconnect(() => {}).pipe(Effect.provide(NodeFileSystem.layer)))).toEqual(
      resolved.endpoint,
    )
  } finally {
    server.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  }
})
