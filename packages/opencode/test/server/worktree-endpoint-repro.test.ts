import { describe, expect } from "bun:test"
import { Effect, Layer, Queue } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { Flag } from "@opencode-ai/core/flag/flag"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { Worktree } from "@/worktree"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { ExperimentalPaths } from "../../src/server/routes/instance/httpapi/groups/experimental"
import { WorkspacePaths } from "../../src/server/routes/instance/httpapi/groups/workspace"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const stateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const original = {
      OPENCODE_EXPERIMENTAL_WORKSPACES: Flag.OPENCODE_EXPERIMENTAL_WORKSPACES,
    }

    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true

    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = original.OPENCODE_EXPERIMENTAL_WORKSPACES
        await resetDatabase()
      }),
    )
  }),
)

const it = testEffect(stateLayer)
const worktreeTest = process.platform === "win32" ? it.instance.skip : it.instance
type TestServer = ReturnType<typeof HttpRouter.toWebHandler>
type CreatedWorktree = { directory: string }
type ScopedWorktree = { directory: string; body: CreatedWorktree; ready: Effect.Effect<void, Error> }

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
  return effect.pipe(
    Effect.timeoutOrElse({
      duration: `${ms} millis`,
      orElse: () => Effect.fail(new Error(`${label} timed out after ${ms}ms`)),
    }),
  )
}

function json<T>(response: Response) {
  return Effect.promise(() => response.json() as Promise<T>)
}

function readyWatcher() {
  return Effect.gen(function* () {
    const events = yield* Queue.bounded<GlobalEvent>(1)
    const on = (event: GlobalEvent) => {
      if (event.payload.type === Worktree.Event.Ready.type) Queue.offerUnsafe(events, event)
    }

    GlobalBus.on("event", on)
    yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", on)))

    return (directory: string) =>
      Effect.gen(function* () {
        while (true) {
          const event = yield* Queue.take(events)
          if (event.directory === directory) return
        }
      }).pipe(
        Effect.timeoutOrElse({
          duration: "10 seconds",
          orElse: () => Effect.fail(new Error(`timed out waiting for worktree.ready: ${directory}`)),
        }),
      )
  })
}

function removeCreatedWorktree(input: {
  server: TestServer
  rootDirectory: string
  worktreeDirectory: string
  ready: Effect.Effect<void, Error>
}) {
  return Effect.gen(function* () {
    yield* input.ready.pipe(Effect.timeout("1 second"), Effect.ignore)
    yield* Effect.promise(() => disposeAllInstances()).pipe(Effect.ignore)

    const removed = yield* request(
      input.server,
      `${ExperimentalPaths.worktree}?directory=${encodeURIComponent(input.rootDirectory)}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: input.worktreeDirectory }),
      },
    )
    if (removed.status !== 200) {
      const message = yield* Effect.promise(() => removed.text())
      throw new Error(`failed to remove worktree: ${removed.status} ${message}`)
    }
    const ok = yield* json<boolean>(removed)
    if (!ok) throw new Error(`failed to remove worktree ${input.worktreeDirectory}`)
  })
}

function createWorktreeScoped(input: {
  server: TestServer
  directory: string
  path: string
  init: RequestInit
  timeoutLabel: string
  timeoutMs?: number
}) {
  return Effect.acquireRelease(
    Effect.gen(function* () {
      const waitReady = yield* readyWatcher()
      const response = yield* withRequestTimeout(
        request(input.server, input.path, input.init),
        input.timeoutLabel,
        input.timeoutMs,
      )
      expect(response.status).toBe(200)
      const body = yield* json<CreatedWorktree>(response)
      return { directory: body.directory, body, ready: waitReady(body.directory) } satisfies ScopedWorktree
    }),
    (created) =>
      removeCreatedWorktree({
        server: input.server,
        rootDirectory: input.directory,
        worktreeDirectory: created.directory,
        ready: created.ready,
      }).pipe(Effect.orDie),
  ).pipe(Effect.map((created) => created.body))
}

function setProjectStartCommand(input: { server: TestServer; directory: string; command: string }) {
  return Effect.gen(function* () {
    const current = yield* request(input.server, `/project/current?directory=${encodeURIComponent(input.directory)}`)
    expect(current.status).toBe(200)
    const project = yield* json<{ id: string }>(current)
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
  worktreeTest(
    "direct HttpApi worktree create returns without waiting for boot",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const server = yield* serverScoped()

        const response = yield* createWorktreeScoped({
          server,
          directory: test.directory,
          path: `${ExperimentalPaths.worktree}?directory=${encodeURIComponent(test.directory)}`,
          init: {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          },
          timeoutLabel: "direct worktree create",
        })

        expect(response).toMatchObject({ directory: expect.any(String) })
      }),
    { git: true },
  )

  worktreeTest(
    "workspace worktree create does not hang",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const server = yield* serverScoped()

        const response = yield* createWorktreeScoped({
          server,
          directory: test.directory,
          path: `${WorkspacePaths.list}?directory=${encodeURIComponent(test.directory)}`,
          init: {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "worktree", branch: null }),
          },
          timeoutLabel: "workspace worktree create",
          timeoutMs: 8_000,
        })

        expect(response).toMatchObject({
          type: "worktree",
          directory: expect.any(String),
        })
      }),
    { git: true },
  )

  worktreeTest(
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
        yield* createWorktreeScoped({
          server,
          directory: test.directory,
          path: `${WorkspacePaths.list}?directory=${encodeURIComponent(test.directory)}`,
          init: {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "worktree", branch: null }),
          },
          timeoutLabel: "workspace worktree create with project start command",
          timeoutMs: 6_000,
        })

        expect(Date.now() - started).toBeLessThan(1_500)
      }),
    { git: true },
  )
})
