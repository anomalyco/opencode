import { NodeFileSystem } from "@effect/platform-node"
import type { EnsureReason } from "@opencode-ai/client/effect/service"
import { Global } from "@opencode-ai/util/global"
import { OPENCODE_VERSION } from "../src/version"
import { expect, test } from "bun:test"
import { Effect, Exit, FileSystem, Scope } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ServerConnection } from "../src/services/server-connection"
import { ServiceConfig } from "../src/services/service-config"

const runReconnect = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)))

test("managed reconnect ensures the service on the first failure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-reconnect-"))
  const starts: EnsureReason[] = []
  try {
    // Short-circuit ensure once it decides to spawn — we only need the reason.
    const exit = await runReconnect(
      ServerConnection.managedReconnect({
        file: path.join(root, "service.json"),
        onStart: (reason) => {
          starts.push(reason)
          throw new Error("service ensure invoked")
        },
      }).pipe(Effect.exit),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(starts).toEqual(["missing"])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("managed reconnect reuses a healthy service from another version", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-reconnect-version-"))
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({ healthy: true, version: "older", pid: process.pid })
    },
  })
  const file = path.join(root, "service.json")
  const url = server.url.toString()
  await Bun.write(file, JSON.stringify({ url, pid: process.pid, version: "older" }))
  try {
    const endpoint = await runReconnect(
      ServerConnection.managedReconnect({
        file,
        version: "newer",
        command: [path.join(root, "must-not-start")],
      }),
    )
    expect(endpoint.url).toBe(url)
  } finally {
    await server.stop(true)
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
        version: OPENCODE_VERSION,
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
        version: OPENCODE_VERSION,
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

test("service options only require a matching version when requested", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-options-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const runPromise = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem | Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer), Effect.scoped))

  try {
    expect((await runPromise(ServiceConfig.options())).version).toBeUndefined()
    expect((await runPromise(ServiceConfig.options({ checkVersion: true }))).version).toBe(OPENCODE_VERSION)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
