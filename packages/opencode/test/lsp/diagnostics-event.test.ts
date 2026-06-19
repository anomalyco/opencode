import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { Deferred, Effect, Layer } from "effect"
import { tmpdir, withTestInstance, TestInstance } from "../fixture/fixture"
import { LSPClient } from "@/lsp/client"
import { LSP } from "@/lsp/lsp"
import * as LSPServer from "@/lsp/server"
import { EventV2Bridge } from "@/event-v2-bridge"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const DEBOUNCE_MS = 150
const fakeServerPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")

function spawnFakeServer() {
  const { spawn } = require("child_process")
  return {
    process: spawn(process.execPath, [fakeServerPath], { stdio: "pipe" }),
  }
}

function publishDiagnostics(client: any, file: string, diagnostics: any[]) {
  return client.connection.sendNotification("test/publish-diagnostics", {
    uri: pathToFileURL(file).href,
    diagnostics,
  })
}

const sampleDiagnostic = {
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
  severity: 1,
  message: "boom",
  source: "fake",
  code: "E001",
}

describe("LSP diagnostics event (client onDiagnostics)", () => {
  test("a single publishDiagnostics emits exactly ONE onDiagnostics after debounce", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "test.ts")
    await Bun.write(file, "const x = 1\n")

    await withTestInstance({
      directory: tmp.path,
      fn: async (ctx) => {
        const emits: { path: string; diagnostics: any[] }[] = []
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
          instance: ctx,
          onDiagnostics: (e) => emits.push(e),
        })

        await client.notify.open({ path: file, buffer: { text: "const x = 1\n", version: 1 } })
        await publishDiagnostics(client, file, [sampleDiagnostic])

        await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 100))

        expect(emits).toHaveLength(1)
        expect(emits[0].path).toBe(file)
        expect(emits[0].diagnostics).toHaveLength(1)
        expect(emits[0].diagnostics[0].message).toBe("boom")
        expect(emits[0].diagnostics[0].code).toBe("E001")

        await client.shutdown()
      },
    })
  })

  test("clearing diagnostics emits an empty array", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "test.ts")
    await Bun.write(file, "const x = 1\n")

    await withTestInstance({
      directory: tmp.path,
      fn: async (ctx) => {
        const emits: { path: string; diagnostics: any[] }[] = []
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
          instance: ctx,
          onDiagnostics: (e) => emits.push(e),
        })

        await client.notify.open({ path: file, buffer: { text: "const x = 1\n", version: 1 } })
        await publishDiagnostics(client, file, [sampleDiagnostic])
        await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 100))

        // Fix the errors -> server publishes an empty set.
        await publishDiagnostics(client, file, [])
        await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 100))

        expect(emits).toHaveLength(2)
        expect(emits[1].path).toBe(file)
        expect(emits[1].diagnostics).toEqual([])

        await client.shutdown()
      },
    })
  })

  test("a burst within the debounce window coalesces to ONE emit", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "test.ts")
    await Bun.write(file, "const x = 1\n")

    await withTestInstance({
      directory: tmp.path,
      fn: async (ctx) => {
        const emits: { path: string; diagnostics: any[] }[] = []
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
          instance: ctx,
          onDiagnostics: (e) => emits.push(e),
        })

        await client.notify.open({ path: file, buffer: { text: "const x = 1\n", version: 1 } })

        // Fire N rapid publishes well within the 150ms window.
        for (let i = 0; i < 5; i++) {
          await publishDiagnostics(client, file, [{ ...sampleDiagnostic, message: `boom-${i}` }])
          await new Promise((r) => setTimeout(r, 10))
        }
        await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 100))

        expect(emits).toHaveLength(1)
        // Last value wins.
        expect(emits[0].diagnostics[0].message).toBe("boom-4")

        await client.shutdown()
      },
    })
  })
})

const it = testEffect(Layer.mergeAll(EventV2Bridge.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("LSP diagnostics event (lsp.diagnostics over the bus)", () => {
  it.instance(
    "publishes lsp.diagnostics with a workspace-relative path + DiagnosticOut payload",
    () =>
      Effect.gen(function* () {
        const dir = (yield* TestInstance).directory
        const events = yield* EventV2Bridge.Service
        const got = yield* Deferred.make<{ path: string; diagnostics: ReadonlyArray<any> }>()

        const unsubscribe = yield* events.listen((event) => {
          if (event.type === LSP.Event.Diagnostics.type) {
            Deferred.doneUnsafe(got, Effect.succeed(event.data as any))
          }
          return Effect.void
        })
        yield* Effect.addFinalizer(() => unsubscribe)

        const file = path.join(dir, "sample.ts")
        yield* Effect.promise(() => Bun.write(file, "const x = 1\n"))

        // Capture the instance-fiber context so the async onDiagnostics callback
        // publishes with routed location — mirrors lsp.ts exactly.
        const context = yield* Effect.context<never>()
        const handle = spawnFakeServer() as any

        const client = yield* Effect.promise(() =>
          LSPClient.create({
            serverID: "fake",
            server: handle as unknown as LSPServer.Handle,
            root: dir,
            directory: dir,
            instance: { directory: dir } as any,
            onDiagnostics: (e) => {
              Effect.runForkWith(context as any)(
                events.publish(LSP.Event.Diagnostics, {
                  path: path.relative(dir, e.path),
                  diagnostics: e.diagnostics.map((d) => ({
                    range: d.range,
                    severity: d.severity,
                    message: d.message,
                    source: d.source,
                    code: typeof d.code === "string" || typeof d.code === "number" ? d.code : undefined,
                  })),
                }),
              )
            },
          }),
        )

        yield* Effect.promise(() => client.notify.open({ path: file, buffer: { text: "const x = 1\n", version: 1 } }))
        yield* Effect.promise(() => publishDiagnostics(client, file, [sampleDiagnostic]))

        const result = yield* awaitWithTimeout(Deferred.await(got), "lsp.diagnostics event was not published")
        expect(result.path).toBe("sample.ts")
        expect(result.diagnostics).toHaveLength(1)
        expect(result.diagnostics[0].message).toBe("boom")
        expect(result.diagnostics[0].code).toBe("E001")

        yield* Effect.promise(() => client.shutdown())
      }),
  )
})
