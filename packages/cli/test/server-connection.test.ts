import { NodeFileSystem } from "@effect/platform-node"
import type { EnsureReason } from "@opencode-ai/client/effect/service"
import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { expect, test } from "bun:test"
import { Effect, FileSystem, Scope } from "effect"
import { createServer } from "node:http"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ServerConnection } from "../src/services/server-connection"
import { ServiceConfig } from "../src/services/service-config"

test("managed reconnect ensures the service on the first failure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-reconnect-"))
  const starts: EnsureReason[] = []
  try {
    const exit = await Effect.runPromise(
      ServerConnection.managedReconnect({
        file: path.join(root, "service.json"),
        onStart: (reason) => {
          starts.push(reason)
          throw new Error("service ensure invoked")
        },
      }).pipe(Effect.provide(NodeFileSystem.layer), Effect.exit),
    )
    expect(exit._tag).toBe("Failure")
    expect(starts).toEqual(["missing"])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("managed reconnect reuses a healthy service from another version", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-reconnect-version-"))
  const server = createServer((request, response) => {
    if (request.url !== "/api/health") {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ healthy: true, version: "older", pid: process.pid }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("Expected TCP server address")
  const file = path.join(root, "service.json")
  const url = `http://127.0.0.1:${address.port}`
  await Bun.write(file, JSON.stringify({ url, pid: process.pid, version: "older" }))
  try {
    const endpoint = await Effect.runPromise(
      ServerConnection.managedReconnect({
        file,
        version: "newer",
        command: [path.join(root, "must-not-start")],
      }).pipe(Effect.provide(NodeFileSystem.layer)),
    )
    expect(endpoint.url).toBe(url)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    )
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("resolution groups Effect-native lifecycle operations only for the managed service", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-server-resolution-"))
  const id = "server-resolution-test"
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({
        healthy: true,
        version: InstallationVersion,
        pid: process.pid,
      })
    },
  })
  const registration = path.join(root, "state", ServiceConfig.filename())
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const runPromise = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem | Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer), Effect.scoped))

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
    const resolved = await runPromise(ServerConnection.resolve({}))

    expect(resolved.endpoint.url).toBe(server.url.toString())
    expect(resolved.service).toBeDefined()
    if (!resolved.service) throw new Error("Expected managed service capabilities")
    expect(Effect.isEffect(resolved.service.reconnect())).toBe(true)
    expect(Effect.isEffect(resolved.service.restart())).toBe(true)
    expect(await runPromise(resolved.service.reconnect())).toEqual(resolved.endpoint)

    const explicit = await runPromise(ServerConnection.resolve({ server: server.url.toString() }))
    expect(explicit.endpoint.url).toBe(server.url.toString())
    expect(explicit.service).toBeUndefined()
  } finally {
    await server.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  }
})
