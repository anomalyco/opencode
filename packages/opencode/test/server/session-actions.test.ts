import { afterEach, describe, expect, mock } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { Session as SessionNs } from "@/session/session"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"
import fs from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"

const it = testEffect(Layer.mergeAll(LayerNode.compile(SessionNs.node), httpApiLayer))

afterEach(async () => {
  mock.restore()
  await disposeAllInstances()
})

describe("session action routes", () => {
  it.instance(
    "fork targetDirectory persists a real worktree location and preserves the source",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const source = yield* Effect.acquireRelease(SessionNs.use.create({ title: "source" }), (created) =>
          SessionNs.use.remove(created.id).pipe(Effect.ignore),
        )
        const target = path.join(test.directory, "..", `fork-${source.id}`)
        yield* Effect.promise(() =>
          $`git worktree add -b ${`fork-${source.id}`} ${target} HEAD`.cwd(test.directory).quiet(),
        )
        yield* Effect.addFinalizer(() =>
          Effect.promise(() => $`git worktree remove --force ${target}`.cwd(test.directory).quiet()).pipe(
            Effect.ignore,
          ),
        )
        const response = yield* requestInDirectory(`/session/${source.id}/fork`, test.directory, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetDirectory: target }),
        })
        expect(response.status).toBe(200)
        const fork = (yield* response.json) as SessionNs.Info
        yield* Effect.addFinalizer(() => SessionNs.use.remove(fork.id).pipe(Effect.ignore))
        expect(fork.directory).toBe(yield* Effect.promise(() => fs.realpath(target)))
        expect((yield* SessionNs.use.get(fork.id)).directory).toBe(fork.directory)
        expect((yield* SessionNs.use.get(source.id)).directory).toBe(source.directory)
        const fetched = yield* requestInDirectory(`/session/${fork.id}`, test.directory)
        expect(((yield* fetched.json) as SessionNs.Info).directory).toBe(fork.directory)
      }),
    { git: true },
  )

  it.instance(
    "an unavailable fork target fails before creating a new session",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const source = yield* Effect.acquireRelease(SessionNs.use.create({}), (created) =>
          SessionNs.use.remove(created.id).pipe(Effect.ignore),
        )
        const before = yield* SessionNs.use.list()
        const response = yield* requestInDirectory(`/session/${source.id}/fork`, test.directory, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetDirectory: path.join(test.directory, "missing") }),
        })
        expect(response.status).toBe(400)
        expect((yield* SessionNs.use.list()).length).toBe(before.length)
      }),
    { git: true },
  )
  it.instance(
    "session routes expose metadata on create, update, get, and fork",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "Content-Type": "application/json" }

        const created = yield* requestInDirectory("/session", test.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: "meta-session",
            metadata: { source: "sdk", trace: { id: "abc" } },
          }),
        })
        expect(created.status).toBe(200)

        const session = (yield* created.json) as SessionNs.Info
        expect(session.metadata).toEqual({ source: "sdk", trace: { id: "abc" } })

        const updated = yield* requestInDirectory(`/session/${session.id}`, test.directory, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ metadata: { source: "sdk", trace: { id: "def" }, tags: ["one"] } }),
        })
        expect(updated.status).toBe(200)

        const next = (yield* updated.json) as SessionNs.Info
        expect(next.metadata).toEqual({ source: "sdk", trace: { id: "def" }, tags: ["one"] })

        const fetched = yield* requestInDirectory(`/session/${session.id}`, test.directory)
        expect(fetched.status).toBe(200)
        expect(((yield* fetched.json) as SessionNs.Info).metadata).toEqual(next.metadata)

        const forked = yield* requestInDirectory(`/session/${session.id}/fork`, test.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        })
        expect(forked.status).toBe(200)

        const fork = (yield* forked.json) as SessionNs.Info
        expect(fork.metadata).toEqual(next.metadata)

        const reset = yield* requestInDirectory(`/session/${session.id}`, test.directory, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ metadata: {} }),
        })
        expect(reset.status).toBe(200)
        expect(((yield* reset.json) as SessionNs.Info).metadata).toEqual({})

        yield* SessionNs.Service.use((svc) => svc.remove(fork.id).pipe(Effect.ignore))
        yield* SessionNs.Service.use((svc) => svc.remove(session.id).pipe(Effect.ignore))
      }),
    { git: true },
  )

  it.instance(
    "abort route returns success",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* Effect.acquireRelease(SessionNs.use.create({}), (created) =>
          SessionNs.use.remove(created.id).pipe(Effect.ignore),
        )

        const res = yield* requestInDirectory(`/session/${session.id}/abort`, test.directory, { method: "POST" })

        expect(res.status).toBe(200)
        expect(yield* res.json).toBe(true)
      }),
    { git: true },
  )

  it.instance(
    "experimental background route is a no-op without synchronous subagents",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* Effect.acquireRelease(SessionNs.use.create({}), (created) =>
          SessionNs.use.remove(created.id).pipe(Effect.ignore),
        )

        const res = yield* requestInDirectory(`/experimental/session/${session.id}/background`, test.directory, {
          method: "POST",
        })

        expect(res.status).toBe(200)
        expect(yield* res.json).toBe(false)
      }),
    { git: true },
  )
})
