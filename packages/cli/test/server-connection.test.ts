import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { OPENCODE_VERSION } from "../src/version"
import { expect, test } from "bun:test"
import { Effect, FileSystem, Scope } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ServerConnection } from "../src/services/server-connection"
import { ServiceConfig } from "../src/services/service-config"
import { isolatedEnv } from "./fixture/environment"

test("resolution groups Effect-native lifecycle operations only for the managed service", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-server-resolution-"))
  const id = "server-resolution-test"
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({
        version: OPENCODE_VERSION,
        pid: process.pid,
        urls: [],
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

test("disabled background service makes CLI API calls standalone without registering a daemon", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-disabled-"))
  const env = isolatedEnv(root)
  const command = [process.execPath, path.join(import.meta.dir, "../src/index.ts")]
  const execute = async (...args: string[]) => {
    const child = Bun.spawn([...command, ...args], {
      cwd: path.join(import.meta.dir, ".."),
      env,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { stdout, stderr, exit }
  }
  const run = async (...args: string[]) => {
    const { stdout, stderr, exit } = await execute(...args)
    expect(exit, stderr).toBe(0)
    expect(stderr).not.toContain("Starting background server")
    return stdout
  }

  try {
    await run("service", "set", "disabled", "true")
    expect(await run("service", "get", "disabled")).toBe("true\n")
    const info = JSON.parse(await run("api", "get", "/api/info"))
    expect(info.pid).toBeGreaterThan(0)
    expect(await run("mcp", "list")).toContain("No MCP servers configured")
    const pairing = await execute("pair")
    expect(pairing.exit).not.toBe(0)
    expect(pairing.stderr).toContain("Pairing requires the background service")

    const explicit = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ version: OPENCODE_VERSION, pid: 12345, urls: [] })
      },
    })
    try {
      expect(JSON.parse(await run("api", "--server", explicit.url.toString(), "get", "/api/info")).pid).toBe(12345)
    } finally {
      await explicit.stop(true)
    }
    expect(await fs.readdir(path.join(root, "state", "opencode")).catch(() => [])).toEqual([])

    await run("service", "unset", "disabled")
    expect(await run("service", "get", "disabled")).toBe("false\n")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)
