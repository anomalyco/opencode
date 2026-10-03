import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Service } from "@opencode/client/service"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Global } from "@opencode/util/global"
import { Effect, FileSystem } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { run } from "../src/app"
import { createEventStream, createFetch } from "./fixture/tui-client"

test("real TUI bootstrap uses managed rediscovery after its resolved listener closes", async () => {
  const source = process.env.OPENCODE_BOOTSTRAP_TREE ?? path.resolve(import.meta.dir, "../../..")
  const app: { run: typeof run } = await import(path.join(source, "packages/tui/src/app.tsx"))
  const directory = await mkdtemp(path.join(tmpdir(), "opencode-bootstrap-"))
  const file = path.join(directory, "service.json")
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false })
  setup.renderer.start()
  const calls = createFetch(undefined, createEventStream())
  using original = Bun.serve({
    port: 0,
    fetch: () => Response.json({ pid: process.pid, version: "test" }),
  })
  const requests: string[] = []
  using successor = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url).pathname)
      if (new URL(request.url).pathname === "/api/info") return Response.json({ pid: process.pid, version: "test" })
      return calls.fetch(request)
    },
  })
  let reconnects = 0
  const ready = Promise.withResolvers<void>()
  const controller = new AbortController()
  try {
    await Bun.write(
      file,
      JSON.stringify({ id: "original", pid: process.pid, url: original.url.toString(), version: "test" }),
    )
    const endpoint = await Service.ensure({ file, command: [] })
    expect(endpoint.url).toBe(original.url.toString())
    await original.stop(true)
    await Bun.write(
      file,
      JSON.stringify({ id: "successor", pid: process.pid, url: successor.url.toString(), version: "test" }),
    )
    const task = Effect.runPromise(
      app
        .run({
          app: { name: "test", version: "test", channel: "test" },
          server: {
            endpoint,
            service: {
              reconnect: async () => {
                reconnects++
                return Service.ensure({ file, command: [] })
              },
              restart: async () => {
                throw new Error("Unexpected restart")
              },
            },
          },
          config: { get: async () => ({ animations: false }), update: async () => ({}) },
          packages: { prepare: async () => ({ directory: "" }) },
          terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: ready.resolve }),
          args: {},
          log: () => {},
        })
        .pipe(
          Effect.provide(Global.layerWith({ state: directory, config: directory })),
          Effect.provide(AppNodeBuilder.build(Global.node)),
          Effect.provide(FileSystem.layerNoop({})),
        ),
      { signal: controller.signal },
    )
    const failed = task.then(() => {
      throw new Error("TUI exited before ready")
    })
    await Promise.race([ready.promise, failed])
    await setup.waitForFrame((frame) => frame.includes("commands"))
    expect(reconnects).toBe(1)
    expect(requests).toContain("/api/info")
    expect(requests).toContain("/api/fs/list")
    expect(requests).toContain("/api/event")
    expect(setup.renderer.isDestroyed).toBe(false)
    // Consume the expected normal completion as well as the early-failure branch.
    void failed.catch(() => {})
    setup.renderer.destroy()
    await task
  } finally {
    controller.abort()
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await rm(directory, { recursive: true, force: true })
  }
})
