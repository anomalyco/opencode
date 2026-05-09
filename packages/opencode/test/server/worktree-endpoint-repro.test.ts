import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { ExperimentalPaths } from "../../src/server/routes/instance/httpapi/groups/experimental"
import { WorkspacePaths } from "../../src/server/routes/instance/httpapi/groups/workspace"
import { withTimeout } from "../../src/util/timeout"
import { resetDatabase } from "../fixture/db"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const stateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const original = {
      OPENCODE_EXPERIMENTAL_HTTPAPI: Flag.OPENCODE_EXPERIMENTAL_HTTPAPI,
      OPENCODE_EXPERIMENTAL_WORKSPACES: Flag.OPENCODE_EXPERIMENTAL_WORKSPACES,
    }

    Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true

    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original.OPENCODE_EXPERIMENTAL_HTTPAPI
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = original.OPENCODE_EXPERIMENTAL_WORKSPACES
        await resetDatabase()
      }),
    )
  }),
)

const it = testEffect(stateLayer)
type TestServer = ReturnType<typeof HttpRouter.toWebHandler>

function serverScoped() {
  return Effect.acquireRelease(
    Effect.sync(() => HttpRouter.toWebHandler(ExperimentalHttpApiServer.routes, { disableLogger: true })),
    (server) => Effect.promise(() => server.dispose()).pipe(Effect.ignore),
  )
}

function request(server: TestServer, input: string, init?: RequestInit) {
  return Effect.promise(() =>
    server.handler(new Request(new URL(input, "http://localhost"), init), ExperimentalHttpApiServer.context),
  )
}

function withRequestTimeout(effect: Effect.Effect<Response>, label: string, ms = 5_000) {
  return Effect.promise(() => withTimeout(Effect.runPromise(effect), ms, label))
}

function setProjectStartCommand(input: { server: TestServer; directory: string; command: string }) {
  return Effect.gen(function* () {
    const current = yield* request(input.server, `/project/current?directory=${encodeURIComponent(input.directory)}`)
    expect(current.status).toBe(200)
    const project = (yield* Effect.promise(() => current.json())) as { id: string }
    const updated = yield* request(
      input.server,
      `/project/${project.id}?directory=${encodeURIComponent(input.directory)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commands: { start: input.command } }),
      },
    )
    expect(updated.status).toBe(200)
  })
}

describe("worktree endpoint reproduction", () => {
  it.instance(
    "direct HttpApi worktree create returns without waiting for boot",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const server = yield* serverScoped()

        const response = yield* withRequestTimeout(
          request(server, `${ExperimentalPaths.worktree}?directory=${encodeURIComponent(test.directory)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          }),
          "direct worktree create",
        )

        expect(response.status).toBe(200)
        expect(yield* Effect.promise(() => response.json())).toMatchObject({ directory: expect.any(String) })
      }),
    { git: true },
  )

  it.instance(
    "workspace worktree create does not hang",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const server = yield* serverScoped()

        const response = yield* withRequestTimeout(
          request(server, `${WorkspacePaths.list}?directory=${encodeURIComponent(test.directory)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "worktree", branch: null }),
          }),
          "workspace worktree create",
          8_000,
        )

        expect(response.status).toBe(200)
        expect(yield* Effect.promise(() => response.json())).toMatchObject({
          type: "worktree",
          directory: expect.any(String),
        })
      }),
    { git: true },
  )

  it.instance(
    "workspace worktree create returns without waiting for project start command",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const server = yield* serverScoped()
        yield* setProjectStartCommand({
          server,
          directory: test.directory,
          command: 'bun -e "setTimeout(() => {}, 2000)"',
        })

        const started = Date.now()
        const response = yield* withRequestTimeout(
          request(server, `${WorkspacePaths.list}?directory=${encodeURIComponent(test.directory)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "worktree", branch: null }),
          }),
          "workspace worktree create with project start command",
          6_000,
        )

        expect(response.status).toBe(200)
        expect(Date.now() - started).toBeLessThan(1_500)
      }),
    { git: true },
  )
})
