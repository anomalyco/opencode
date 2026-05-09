import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Flag } from "@opencode-ai/core/flag/flag"
import { describe, expect } from "bun:test"
import { Config, Effect, FileSystem, Layer, Path } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { WorkspaceID } from "../../src/control-plane/schema"
import { ControlPaths } from "../../src/server/routes/instance/httpapi/groups/control"
import { InstancePaths } from "../../src/server/routes/instance/httpapi/groups/instance"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { HEADER as FenceHeader } from "../../src/server/shared/fence"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// Flip the experimental HttpApi flag so backend selection telemetry on the
// production routes reports the right backend, and the experimental
// workspaces flag so SyncEvent.run actually writes to EventSequenceTable
// (the source of truth the fence middleware reads). Reset the database
// around the test so per-instance state does not leak between runs.
// resetDatabase() already calls disposeAllInstances(), so we don't repeat it.
const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const originalHttpApi = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
    const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
    Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = originalHttpApi
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
        await resetDatabase()
      }),
    )
  }),
)

// Mount the production HttpApi route tree on a real Node HTTP server bound to
// 127.0.0.1:0 and a fetch-based HttpClient that prepends the server URL. This
// keeps the test wired through the same route layer production uses, without
// going through Server.Default()/Hono.
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  ExperimentalHttpApiServer.routes,
  { disableListenLog: true, disableLogger: true },
)

const httpApiServerLayer = servedRoutes.pipe(
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)

const it = testEffect(Layer.mergeAll(testStateLayer, httpApiServerLayer))

const directoryHeader = (dir: string) => HttpClientRequest.setHeader("x-opencode-directory", dir)

describe("instance HttpApi", () => {
  it.live("serves the OpenAPI document", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.get("/doc")

      expect(response.status).toBe(200)
      expect(response.headers["content-type"]).toContain("application/json")
      expect(yield* response.json).toMatchObject({
        openapi: expect.any(String),
        info: expect.any(Object),
        paths: expect.objectContaining({
          "/global/health": expect.any(Object),
          "/session": expect.any(Object),
        }),
      })
    }),
  )

  it.live("emits a sync fence header for fixed-workspace mutations", () =>
    Effect.gen(function* () {
      const originalWorkspaceID = Flag.OPENCODE_WORKSPACE_ID
      Flag.OPENCODE_WORKSPACE_ID = WorkspaceID.ascending()
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          Flag.OPENCODE_WORKSPACE_ID = originalWorkspaceID
        }),
      )

      const dir = yield* tmpdirScoped({ git: true })
      const response = yield* HttpClientRequest.post(SessionPaths.create).pipe(
        directoryHeader(dir),
        HttpClientRequest.bodyJson({ title: "fenced" }),
        Effect.flatMap(HttpClient.execute),
      )

      expect(response.status).toBe(200)
      expect(JSON.parse(response.headers[FenceHeader] ?? "{}")).not.toEqual({})
    }),
  )

  it.live("does not emit sync fence headers for fixed-workspace reads or no-op mutations", () =>
    Effect.gen(function* () {
      const originalWorkspaceID = Flag.OPENCODE_WORKSPACE_ID
      Flag.OPENCODE_WORKSPACE_ID = WorkspaceID.ascending()
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          Flag.OPENCODE_WORKSPACE_ID = originalWorkspaceID
        }),
      )

      const dir = yield* tmpdirScoped({ git: true })
      const read = yield* HttpClientRequest.get(InstancePaths.path).pipe(directoryHeader(dir), HttpClient.execute)
      const log = yield* HttpClientRequest.post(ControlPaths.log).pipe(
        directoryHeader(dir),
        HttpClientRequest.bodyJson({ service: "fence-test", level: "info", message: "noop" }),
        Effect.flatMap(HttpClient.execute),
      )

      expect(read.status).toBe(200)
      expect(read.headers[FenceHeader]).toBeUndefined()
      expect(log.status).toBe(200)
      expect(log.headers[FenceHeader]).toBeUndefined()
    }),
  )

  it.live("serves path and VCS read endpoints", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      yield* fs.writeFileString(path.join(dir, "changed.txt"), "hello")

      const [paths, vcs, diff] = yield* Effect.all(
        [
          HttpClientRequest.get(InstancePaths.path).pipe(directoryHeader(dir), HttpClient.execute),
          HttpClientRequest.get(InstancePaths.vcs).pipe(directoryHeader(dir), HttpClient.execute),
          HttpClientRequest.get(InstancePaths.vcsDiff).pipe(
            HttpClientRequest.setUrlParam("mode", "git"),
            directoryHeader(dir),
            HttpClient.execute,
          ),
        ],
        { concurrency: "unbounded" },
      )

      expect(paths.status).toBe(200)
      expect(yield* paths.json).toMatchObject({ directory: dir, worktree: dir })

      expect(vcs.status).toBe(200)
      expect(yield* vcs.json).toMatchObject({ branch: expect.any(String) })

      expect(diff.status).toBe(200)
      expect(yield* diff.json).toContainEqual(
        expect.objectContaining({ file: "changed.txt", additions: 1, status: "added" }),
      )
    }),
  )
})
