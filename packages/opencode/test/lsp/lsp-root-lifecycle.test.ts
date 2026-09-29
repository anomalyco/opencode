import { afterEach, beforeEach, describe, expect, spyOn } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Fiber, Layer } from "effect"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { spawn } from "@/lsp/launch"
import { LSP } from "@/lsp/lsp"
import * as LSPServer from "@/lsp/server"
import type { InstanceContext } from "@/project/instance-context"
import { TestInstance, disposeAllInstancesEffect, reloadInstance } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const lspLayer = LayerNode.compile(LayerNode.group([LSP.node, Config.node, RuntimeFlags.node, EventV2Bridge.node]))
const it = testEffect(Layer.mergeAll(lspLayer, LayerNode.compile(CrossSpawnSpawner.node)))
const fakeServer = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")

async function waitForFile(file: string) {
  const started = Date.now()
  while (Date.now() - started < 5_000) {
    if (
      await fs
        .stat(file)
        .then(() => true)
        .catch(() => false)
    )
      return
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for ${file}`)
}

async function waitForEvent(file: string, event: string) {
  const started = Date.now()
  while (Date.now() - started < 5_000) {
    if ((await fs.readFile(file, "utf8").catch(() => "")).split("\n").includes(event)) return
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for ${event} in ${file}`)
}

async function waitForProcessExit(pid: number) {
  const started = Date.now()
  while (Date.now() - started < 5_000) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for process ${pid} to exit`)
}

async function waitForEndpoint(endpoint: string, available: boolean) {
  const started = Date.now()
  while (Date.now() - started < 5_000) {
    const live = await fetch(endpoint).then(
      (response) => response.ok,
      () => false,
    )
    if (live === available) return
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for ${endpoint} to become ${available ? "available" : "unavailable"}`)
}

async function stopProcess(pid: number) {
  try {
    process.kill(pid, "SIGKILL")
  } catch {}
}

const config = {
  lsp: {
    deno: { disabled: true as const },
    eslint: { disabled: true as const },
    oxlint: { disabled: true as const },
    biome: { disabled: true as const },
  },
}

describe("LSP root lifecycle", () => {
  let spawnSpy: ReturnType<typeof spyOn>
  let rootSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    spawnSpy = spyOn(LSPServer.Typescript, "spawn")
    rootSpy = spyOn(LSPServer.Typescript, "root")
  })

  afterEach(() => {
    spawnSpy.mockRestore()
    rootSpy.mockRestore()
  })

  it.instance(
    "shares one live server while concurrent requests initialize the same root",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const file = path.join(dir, "sample.ts")
          yield* Effect.promise(() => Bun.write(file, "export const sample = 1\n"))
          spawnSpy.mockImplementation(async (root: string) => ({
            process: spawn(process.execPath, [fakeServer], { cwd: root }),
          }))

          yield* Effect.all([lsp.hover({ file, line: 0, character: 0 }), lsp.hover({ file, line: 0, character: 0 })], {
            concurrency: "unbounded",
          })

          expect(spawnSpy).toHaveBeenCalledTimes(1)
          expect(yield* lsp.status()).toHaveLength(1)
        }),
      ),
    { config },
  )

  it.instance(
    "does not register work after reload disposes a root-gated state",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const file = path.join(dir, "sample.ts")
          const release = path.join(dir, "root-release")
          yield* Effect.promise(() => Bun.write(file, "export const sample = 1\n"))
          let started!: () => void
          const startedPromise = new Promise<void>((resolve) => {
            started = resolve
          })
          let first = true
          rootSpy.mockImplementation(async (_file: string, ctx: InstanceContext) => {
            if (!first) return ctx.directory
            first = false
            started()
            await waitForFile(release)
            return ctx.directory
          })
          spawnSpy.mockImplementation(async (root: string) => ({
            process: spawn(process.execPath, [fakeServer], { cwd: root }),
          }))
          yield* Effect.addFinalizer(() => Effect.promise(() => Bun.write(release, "release")))

          const pending = yield* lsp.hover({ file, line: 0, character: 0 }).pipe(Effect.forkScoped)
          yield* Effect.promise(() => startedPromise)
          yield* reloadInstance({ directory: dir })
          yield* Effect.promise(() => Bun.write(release, "release"))
          yield* awaitWithTimeout(Fiber.join(pending), "root-gated request did not settle")
          expect(spawnSpy).toHaveBeenCalledTimes(0)

          yield* lsp.hover({ file, line: 0, character: 0 })
          expect(spawnSpy).toHaveBeenCalledTimes(1)
          expect(yield* lsp.status()).toHaveLength(1)
        }),
      ),
    { config },
  )

  it.instance(
    "uses the current root generation after a delayed root lookup completes",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const file = path.join(dir, "sample.ts")
          const release = path.join(dir, "delayed-root-release")
          yield* Effect.promise(() => Bun.write(file, "export const sample = 1\n"))
          let started!: () => void
          const startedPromise = new Promise<void>((resolve) => {
            started = resolve
          })
          let first = true
          rootSpy.mockImplementation(async (_file: string, ctx: InstanceContext) => {
            if (!first) return ctx.directory
            first = false
            started()
            await waitForFile(release)
            return ctx.directory
          })
          spawnSpy.mockImplementation(async (root: string) => ({
            process: spawn(process.execPath, [fakeServer], { cwd: root }),
          }))
          yield* Effect.addFinalizer(() => Effect.promise(() => Bun.write(release, "release")))

          const delayed = yield* lsp.hover({ file, line: 0, character: 0 }).pipe(Effect.forkScoped)
          yield* Effect.promise(() => startedPromise)
          yield* lsp.hover({ file, line: 0, character: 0 })
          yield* Effect.promise(() => Bun.write(release, "release"))
          yield* awaitWithTimeout(Fiber.join(delayed), "delayed root request did not settle")

          expect(spawnSpy).toHaveBeenCalledTimes(1)
          expect(yield* lsp.status()).toHaveLength(1)
        }),
      ),
    { config },
  )

  it.instance(
    "returns one initialized client to a delayed-initialization joiner",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const file = path.join(dir, "sample.ts")
          const events = path.join(dir, "late-joiner-events")
          const release = path.join(dir, "late-joiner-release")
          yield* Effect.promise(() => Bun.write(file, "export const sample = 1\n"))
          spawnSpy.mockImplementation(async (root: string) => ({
            process: spawn(process.execPath, [fakeServer], {
              cwd: root,
              env: {
                ...process.env,
                OPENCODE_TEST_LSP_EVENT_FILE: events,
                OPENCODE_TEST_LSP_INITIALIZE_RELEASE_FILE: release,
                OPENCODE_TEST_LSP_RECORD_INITIALIZE: "1",
              },
            }),
          }))
          yield* Effect.addFinalizer(() => Effect.promise(() => Bun.write(release, "release")))

          const first = yield* lsp.hover({ file, line: 0, character: 0 }).pipe(Effect.forkScoped)
          yield* Effect.promise(() => waitForEvent(events, "initialize"))
          const joining = yield* lsp.hover({ file, line: 0, character: 0 }).pipe(Effect.forkScoped)
          yield* Effect.promise(() => Bun.write(release, "release"))
          yield* awaitWithTimeout(Fiber.join(first), "initial request did not settle")
          yield* awaitWithTimeout(Fiber.join(joining), "joining request did not settle")

          expect(spawnSpy).toHaveBeenCalledTimes(1)
          expect(yield* lsp.status()).toHaveLength(1)
        }),
      ),
    { config },
  )

  it.instance(
    "stops a returned handle when disposal interrupts initialization",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const file = path.join(dir, "sample.ts")
          const events = path.join(dir, "events")
          const release = path.join(dir, "initialize-release")
          yield* Effect.promise(() => Bun.write(file, "export const sample = 1\n"))
          let handle: ReturnType<typeof spawn> | undefined
          spawnSpy.mockImplementation(async (root: string) => {
            const proc = spawn(process.execPath, [fakeServer], {
              cwd: root,
              env: {
                ...process.env,
                OPENCODE_TEST_LSP_EVENT_FILE: events,
                OPENCODE_TEST_LSP_INITIALIZE_RELEASE_FILE: release,
                OPENCODE_TEST_LSP_RECORD_INITIALIZE: "1",
              },
            })
            handle = proc
            return { process: proc }
          })

          const pending = yield* lsp.hover({ file, line: 0, character: 0 }).pipe(Effect.forkScoped)
          yield* Effect.promise(() => waitForFile(events))
          expect(yield* Effect.promise(() => fs.readFile(events, "utf8"))).toContain("initialize\n")

          yield* disposeAllInstancesEffect
          expect(handle).toBeDefined()
          const pendingHandle = handle
          if (pendingHandle) yield* Effect.promise(() => pendingHandle.exited)
          yield* Fiber.interrupt(pending)
        }),
      ),
    { config },
  )

  it.instance(
    "stops a handle returned by a retired spawn without disturbing its replacement",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const file = path.join(dir, "sample.ts")
          const release = path.join(dir, "spawn-release")
          const staleEvents = path.join(dir, "stale-events")
          yield* Effect.promise(() => Bun.write(file, "export const sample = 1\n"))
          let started!: () => void
          const startedPromise = new Promise<void>((resolve) => {
            started = resolve
          })
          let staleReady!: (handle: ReturnType<typeof spawn>) => void
          const staleHandle = new Promise<ReturnType<typeof spawn>>((resolve) => {
            staleReady = resolve
          })
          let first = true
          spawnSpy.mockImplementation(async (root: string) => {
            if (!first) return { process: spawn(process.execPath, [fakeServer], { cwd: root }) }
            first = false
            started()
            await waitForFile(release)
            const stale = spawn(process.execPath, [fakeServer], {
              cwd: root,
              env: {
                ...process.env,
                OPENCODE_TEST_LSP_EVENT_FILE: staleEvents,
                OPENCODE_TEST_LSP_RECORD_START: "1",
                OPENCODE_TEST_LSP_RECORD_INITIALIZE: "1",
              },
            })
            staleReady(stale)
            return { process: stale }
          })
          yield* Effect.addFinalizer(() => Effect.promise(() => Bun.write(release, "release")))

          const pending = yield* lsp.hover({ file, line: 0, character: 0 }).pipe(Effect.forkScoped)
          yield* Effect.promise(() => startedPromise)
          yield* reloadInstance({ directory: dir })

          yield* lsp.hover({ file, line: 0, character: 0 })
          expect(yield* lsp.status()).toHaveLength(1)

          yield* Effect.promise(() => Bun.write(release, "release"))
          yield* Effect.promise(async () => (await staleHandle).exited)
          expect(yield* Effect.promise(() => fs.readFile(staleEvents, "utf8").catch(() => ""))).not.toContain(
            "initialize",
          )
          yield* awaitWithTimeout(Fiber.join(pending), "retired spawn did not settle")
          expect(yield* lsp.status()).toHaveLength(1)
        }),
      ),
    { config },
  )

  it.instance(
    "retires a deleted root and its owned descendant without another LSP request",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const root = path.join(dir, "deleted-root")
          const file = path.join(root, "sample.ts")
          const events = path.join(dir, "deleted-events")
          const descendant = path.join(dir, "deleted-descendant-pid")
          let descendantPID: number | undefined
          yield* Effect.addFinalizer(() =>
            Effect.promise(async () => {
              if (descendantPID) await stopProcess(descendantPID)
            }),
          )
          yield* Effect.promise(async () => {
            await fs.mkdir(root)
            await Bun.write(file, "export const sample = 1\n")
          })
          rootSpy.mockResolvedValue(root)
          spawnSpy.mockImplementation(async (serverRoot: string) => ({
            process: spawn(process.execPath, [fakeServer], {
              cwd: serverRoot,
              env: {
                ...process.env,
                OPENCODE_TEST_LSP_EVENT_FILE: events,
                OPENCODE_TEST_LSP_RECORD_START: "1",
                OPENCODE_TEST_LSP_DESCENDANT_EVENT_FILE: events,
                OPENCODE_TEST_LSP_DESCENDANT_PID_FILE: descendant,
                OPENCODE_TEST_LSP_DESCENDANT_EXPIRY_MS: "10000",
              },
            }),
          }))

          yield* lsp.hover({ file, line: 0, character: 0 })
          yield* Effect.promise(() => waitForEvent(events, "descendant-start"))
          const [pid, endpoint] = yield* Effect.promise(() =>
            fs.readFile(descendant, "utf8").then((value) => value.split("\n")),
          )
          if (!pid || !endpoint) throw new Error("Descendant did not publish its process and endpoint")
          descendantPID = Number(pid)
          process.kill(descendantPID, 0)
          yield* Effect.promise(() => waitForEndpoint(endpoint, true))
          yield* Effect.promise(() => fs.rm(root, { recursive: true }))

          yield* Effect.promise(() => waitForEvent(events, "exit"))
          yield* Effect.promise(() => waitForProcessExit(descendantPID))
          yield* Effect.promise(() => waitForEndpoint(endpoint, false))
          expect(spawnSpy).toHaveBeenCalledTimes(1)
          expect(yield* lsp.status()).toEqual([])
        }),
      ),
    { config },
  )

  it.instance(
    "retains a live sibling and reuses its client after another root is deleted",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const left = path.join(dir, "left")
          const right = path.join(dir, "right")
          const leftFile = path.join(left, "sample.ts")
          const rightFile = path.join(right, "sample.ts")
          const leftEvents = path.join(dir, "left-events")
          const rightEvents = path.join(dir, "right-events")
          yield* Effect.promise(async () => {
            await Promise.all([fs.mkdir(left), fs.mkdir(right)])
            await Promise.all([
              Bun.write(leftFile, "export const left = 1\n"),
              Bun.write(rightFile, "export const right = 1\n"),
            ])
          })
          rootSpy.mockImplementation(async (input: string) => path.dirname(input))
          spawnSpy.mockImplementation(async (serverRoot: string) => ({
            process: spawn(process.execPath, [fakeServer], {
              cwd: serverRoot,
              env: {
                ...process.env,
                OPENCODE_TEST_LSP_EVENT_FILE: serverRoot === left ? leftEvents : rightEvents,
                OPENCODE_TEST_LSP_RECORD_START: "1",
              },
            }),
          }))

          yield* lsp.hover({ file: leftFile, line: 0, character: 0 })
          yield* lsp.hover({ file: rightFile, line: 0, character: 0 })
          yield* Effect.promise(() => fs.rm(left, { recursive: true }))
          yield* Effect.promise(() => waitForEvent(leftEvents, "exit"))

          yield* lsp.hover({ file: rightFile, line: 0, character: 0 })
          expect(spawnSpy).toHaveBeenCalledTimes(2)
          expect(yield* lsp.status()).toHaveLength(1)
          expect(yield* Effect.promise(() => fs.readFile(rightEvents, "utf8"))).not.toContain("shutdown")
        }),
      ),
    { config },
  )

  it.instance(
    "keeps a recreated root client alive while stale cleanup finishes",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const root = path.join(dir, "recreated-root")
          const retired = path.join(dir, "retired-root")
          const replacement = path.join(dir, "replacement-root")
          const file = path.join(root, "sample.ts")
          const release = path.join(dir, "stale-shutdown-release")
          const staleEvents = path.join(dir, "stale-root-events")
          const freshEvents = path.join(dir, "fresh-root-events")
          yield* Effect.promise(async () => {
            await fs.mkdir(root)
            await Bun.write(file, "export const sample = 1\n")
            await fs.mkdir(replacement)
            await Bun.write(path.join(replacement, "sample.ts"), "export const sample = 2\n")
          })
          rootSpy.mockResolvedValue(root)
          let first = true
          spawnSpy.mockImplementation(async (serverRoot: string) => {
            const env = first
              ? {
                  ...process.env,
                  OPENCODE_TEST_LSP_EVENT_FILE: staleEvents,
                  OPENCODE_TEST_LSP_RECORD_START: "1",
                  OPENCODE_TEST_LSP_SHUTDOWN_RELEASE_FILE: release,
                }
              : {
                  ...process.env,
                  OPENCODE_TEST_LSP_EVENT_FILE: freshEvents,
                  OPENCODE_TEST_LSP_RECORD_START: "1",
                }
            first = false
            return { process: spawn(process.execPath, [fakeServer], { cwd: serverRoot, env }) }
          })

          yield* lsp.hover({ file, line: 0, character: 0 })
          yield* Effect.promise(() => waitForEvent(staleEvents, "start"))
          yield* Effect.promise(async () => {
            await fs.rename(root, retired)
            await fs.rename(replacement, root)
          })

          yield* Effect.all([lsp.hover({ file, line: 0, character: 0 }), lsp.hover({ file, line: 0, character: 0 })], {
            concurrency: "unbounded",
          })
          yield* Effect.promise(() => waitForEvent(freshEvents, "start"))
          expect(spawnSpy).toHaveBeenCalledTimes(2)
          yield* Effect.promise(() => waitForEvent(staleEvents, "shutdown"))
          yield* Effect.promise(() => Bun.write(release, "release"))
          yield* Effect.promise(() => waitForEvent(staleEvents, "exit"))
          yield* lsp.hover({ file, line: 0, character: 0 })
          expect(spawnSpy).toHaveBeenCalledTimes(2)
          expect(yield* lsp.status()).toHaveLength(1)
          expect(yield* Effect.promise(() => fs.readFile(freshEvents, "utf8"))).not.toContain("shutdown")
        }),
      ),
    { config },
  )

  it.instance(
    "preserves a root while stat access is uncertain",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          if (process.platform === "win32" || typeof process.getuid !== "function" || process.getuid() === 0) return

          const dir = (yield* TestInstance).directory
          const parent = path.join(dir, "inaccessible-parent")
          const root = path.join(parent, "root")
          const file = path.join(root, "sample.ts")
          const events = path.join(dir, "inaccessible-events")
          yield* Effect.promise(async () => {
            await fs.mkdir(root, { recursive: true })
            await Bun.write(file, "export const sample = 1\n")
          })
          yield* Effect.addFinalizer(() => Effect.promise(() => fs.chmod(parent, 0o700).catch(() => undefined)))
          rootSpy.mockResolvedValue(root)
          spawnSpy.mockImplementation(async (serverRoot: string) => ({
            process: spawn(process.execPath, [fakeServer], {
              cwd: serverRoot,
              env: {
                ...process.env,
                OPENCODE_TEST_LSP_EVENT_FILE: events,
                OPENCODE_TEST_LSP_RECORD_START: "1",
              },
            }),
          }))

          yield* lsp.hover({ file, line: 0, character: 0 })
          yield* Effect.promise(() => waitForEvent(events, "start"))
          yield* Effect.promise(() => fs.chmod(parent, 0o000))
          const inaccessible = yield* Effect.promise(() =>
            fs.stat(root).then(
              () => undefined,
              (error) => error,
            ),
          )
          expect(inaccessible).toMatchObject({ code: "EACCES" })

          yield* lsp.hover({ file, line: 0, character: 0 })
          expect(spawnSpy).toHaveBeenCalledTimes(1)
          expect(yield* lsp.status()).toHaveLength(1)
          yield* Effect.promise(() => fs.chmod(parent, 0o700))
        }),
      ),
    { config },
  )
})
