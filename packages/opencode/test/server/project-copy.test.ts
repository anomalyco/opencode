import { afterEach, describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { HttpClientResponse } from "effect/unstable/http"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Database } from "@opencode-ai/core/database/database"
import { Snapshot } from "@/snapshot"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const testInstanceStore = LayerNode.compile(InstanceStore.node, [[InstanceStore.bootstrapNode, noopBootstrap]])
const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(LayerNode.group([FSUtil.node, Database.node, Snapshot.node])),
    testInstanceStore,
    httpApiLayer,
  ),
)

function request(directory: string, url: string, init: RequestInit = {}) {
  return requestInDirectory(url, directory, init)
}

function json<T>(response: HttpClientResponse.HttpClientResponse) {
  return response.json.pipe(Effect.map((value) => value as T))
}

describe("project directories and copies endpoints", () => {
  type ProjectDirectory = { directory: string; strategy?: string }

  it.instance(
    "lists directories and manages git worktree copies",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const current = yield* request(test.directory, "/project/current")
        const projectID = (yield* json<{ id: string }>(current)).id
        const base = `/project/${projectID}`
        const copies = `/experimental/project/${projectID}/copy?location%5Bdirectory%5D=${encodeURIComponent(test.directory)}`
        const createdParent = path.join(test.directory, "..", path.basename(test.directory) + "-http-copy")
        const createdDirectory = path.join(createdParent, "copy")
        yield* Effect.addFinalizer(() =>
          Effect.promise(() => fs.rm(createdParent, { recursive: true, force: true })).pipe(Effect.ignore),
        )

        const initial = yield* request(test.directory, `${base}/directories`)
        expect(initial.status).toBe(200)
        expect(yield* json<ProjectDirectory[]>(initial)).toEqual([{ directory: test.directory }])

        const generated = yield* request(test.directory, `/experimental/project/${projectID}/copy/generate-name`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ context: undefined }),
        })
        expect(generated.status).toBe(200)
        expect((yield* json<{ name: string }>(generated)).name).toBeString()

        const create = yield* request(test.directory, copies, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ strategy: "git_worktree", directory: createdParent, name: "copy" }),
        })
        expect(create.status).toBe(200)
        const created = yield* json<{ directory: string }>(create)
        expect(created.directory).toBe(createdDirectory)

        const listed = yield* request(test.directory, `${base}/directories`)
        expect(yield* json<ProjectDirectory[]>(listed)).toContainEqual({
          directory: created.directory,
          strategy: "git_worktree",
        })

        yield* Effect.promise(() => Bun.write(path.join(created.directory, "dirty.txt"), "dirty"))

        const remove = yield* request(test.directory, copies, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ directory: created.directory, force: false }),
        })
        expect(remove.status).toBe(400)
        expect(yield* json<{ data: { forceRequired?: boolean } }>(remove)).toMatchObject({
          data: { forceRequired: true },
        })

        const forced = yield* request(test.directory, copies, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ directory: created.directory, force: true }),
        })
        expect(forced.status).toBe(204)

        const externalDirectory = path.join(test.directory, "..", path.basename(test.directory) + "-http-refresh")
        yield* Effect.addFinalizer(() =>
          Effect.promise(() => fs.rm(externalDirectory, { recursive: true, force: true })).pipe(Effect.ignore),
        )
        yield* Effect.promise(() => $`git worktree add --detach ${externalDirectory} HEAD`.cwd(test.directory).quiet())
        const refresh = yield* request(
          test.directory,
          `/experimental/project/${projectID}/copy/refresh?location%5Bdirectory%5D=${encodeURIComponent(test.directory)}`,
          {
            method: "POST",
          },
        )
        expect(refresh.status).toBe(204)
        const refreshed = yield* request(test.directory, `${base}/directories`)
        expect(yield* json<ProjectDirectory[]>(refreshed)).toEqual([
          { directory: externalDirectory, strategy: "git_worktree" },
          { directory: test.directory },
        ])
      }),
    { git: true },
  )
})
