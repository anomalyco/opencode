import { afterEach, describe, expect, test } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Flag } from "@opencode-ai/core/flag/flag"
import { PtyID } from "../../src/pty/schema"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { PtyPaths } from "../../src/server/routes/instance/httpapi/groups/pty"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir, tmpdirScoped } from "../fixture/fixture"
import { Config, Effect, Layer, Queue, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { Pty } from "../../src/pty"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const testPty = process.platform === "win32" ? test.skip : test

const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
        await resetDatabase()
      }),
    )
  }),
)

const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  ExperimentalHttpApiServer.routes,
  { disableListenLog: true, disableLogger: true },
)

const effectIt = testEffect(
  Layer.mergeAll(
    testStateLayer,
    Socket.layerWebSocketConstructorGlobal,
    servedRoutes.pipe(
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
      Layer.provideMerge(NodeHttpServer.layerTest),
      Layer.provideMerge(NodeServices.layer),
    ),
  ),
)

function app() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  return Server.Default().app
}

function serverUrl() {
  return HttpServer.HttpServer.use((server) => Effect.succeed(HttpServer.formatAddress(server.address)))
}

const directoryHeader = (dir: string) => HttpClientRequest.setHeader("x-opencode-directory", dir)

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await Instance.disposeAll()
  await resetDatabase()
})

describe("pty HttpApi bridge", () => {
  test("serves available shell list through experimental Effect routes", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(PtyPaths.shells, { headers: { "x-opencode-directory": tmp.path } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.any(String),
          name: expect.any(String),
          acceptable: expect.any(Boolean),
        }),
      ]),
    )
  })

  testPty("serves PTY JSON routes through experimental Effect routes", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path }
    const list = await app().request(PtyPaths.list, { headers })
    expect(list.status).toBe(200)
    expect(await list.json()).toEqual([])

    const created = await app().request(PtyPaths.create, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ command: "/usr/bin/env", args: ["sh", "-c", "sleep 5"], title: "demo" }),
    })
    expect(created.status).toBe(200)
    const info = await created.json()

    try {
      expect(info).toMatchObject({ title: "demo", command: "/usr/bin/env", status: "running" })

      const found = await app().request(PtyPaths.get.replace(":ptyID", info.id), { headers })
      expect(found.status).toBe(200)
      expect(await found.json()).toMatchObject({ id: info.id, title: "demo" })

      const updated = await app().request(PtyPaths.update.replace(":ptyID", info.id), {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ title: "renamed", size: { cols: 80, rows: 24 } }),
      })
      expect(updated.status).toBe(200)
      expect(await updated.json()).toMatchObject({ id: info.id, title: "renamed" })
    } finally {
      await app().request(PtyPaths.remove.replace(":ptyID", info.id), { method: "DELETE", headers })
    }

    const missing = await app().request(PtyPaths.get.replace(":ptyID", info.id), { headers })
    expect(missing.status).toBe(404)
  })

  test("returns 404 for missing PTY websocket before upgrade", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(PtyPaths.connect.replace(":ptyID", PtyID.ascending()), {
      headers: { "x-opencode-directory": tmp.path },
    })
    expect(response.status).toBe(404)
  })
  ;(process.platform === "win32" ? effectIt.live.skip : effectIt.live)(
    "serves PTY websocket output and input through Effect routes",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true, config: { formatter: false, lsp: false } })
        const created = yield* HttpClientRequest.post(PtyPaths.create).pipe(
          directoryHeader(dir),
          HttpClientRequest.bodyJson({ command: "/bin/cat", title: "websocket" }),
          Effect.flatMap(HttpClient.execute),
        )
        expect(created.status).toBe(200)
        const info = yield* Schema.decodeUnknownEffect(Pty.Info)(yield* created.json)

        const socket = yield* Socket.makeWebSocket(
          `${(yield* serverUrl()).replace(/^http/, "ws")}${PtyPaths.connect.replace(":ptyID", info.id)}?cursor=-1&directory=${encodeURIComponent(dir)}`,
          { closeCodeIsError: () => false },
        )
        const messages = yield* Queue.unbounded<string>()
        yield* socket
          .runRaw((message) =>
            Queue.offer(messages, typeof message === "string" ? message : new TextDecoder().decode(message)),
          )
          .pipe(Effect.catch(() => Effect.void))
          .pipe(Effect.forkScoped)
        const write = yield* socket.writer

        const takeUntil = (expected: string, seen = ""): Effect.Effect<string, unknown> =>
          Effect.gen(function* () {
            const next = seen + (yield* Queue.take(messages).pipe(Effect.timeout("5 seconds")))
            if (next.includes(expected)) return next
            return yield* takeUntil(expected, next)
          })

        yield* write("ping-route\n")
        expect(yield* takeUntil("ping-route")).toContain("ping-route")
        yield* write(new Socket.CloseEvent(1000, "done")).pipe(Effect.catch(() => Effect.void))

        const removed = yield* HttpClientRequest.delete(PtyPaths.remove.replace(":ptyID", info.id)).pipe(
          directoryHeader(dir),
          HttpClient.execute,
        )
        expect(removed.status).toBe(200)
      }),
  )
})
