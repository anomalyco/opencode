import { afterEach, describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Schedule } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { eq } from "drizzle-orm"
import { CrossSpawnSpawner } from "@cedric/core/cross-spawn-spawner"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { ExperimentalPaths } from "../../src/server/routes/instance/httpapi/groups/experimental"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SessionTable } from "@cedric/core/session/sql"
import { Database } from "@cedric/core/database/database"
import { AccountV2 } from "@cedric/core/account"
import { AccountTable } from "@cedric/core/account/sql"
import * as Log from "@cedric/core/util/log"
import { Worktree } from "../../src/worktree"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideTmpdirServer, TestInstance } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

void Log.init({ print: false })

const it = testEffect(Layer.mergeAll(Session.defaultLayer, BackgroundJob.defaultLayer, Database.defaultLayer, httpApiLayer))
const testWorktreeMutations = process.platform === "win32" ? it.instance.skip : it.instance

function request(path: string, directory: string, init: RequestInit = {}) {
  return requestInDirectory(path, directory, init)
}

function createSession(input?: Session.CreateInput) {
  return Session.use.create(input)
}

function json<T>(response: HttpClientResponse.HttpClientResponse) {
  return response.json.pipe(Effect.map((value) => value as T))
}

function waitReady(input: { directory?: string; name?: string }) {
  return Effect.gen(function* () {
    const ready = yield* Deferred.make<void>()
    const on = (event: GlobalEvent) => {
      if (event.payload.type !== Worktree.Event.Ready.type) return
      if (input.directory && event.directory !== input.directory) return
      if (input.name && event.payload.properties.name !== input.name) return
      Deferred.doneUnsafe(ready, Effect.void)
    }

    GlobalBus.on("event", on)
    yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", on)))

    return yield* Deferred.await(ready).pipe(
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () => Effect.fail(new Error("timed out waiting for worktree.ready")),
      }),
    )
  })
}

function insertAccount() {
  return Effect.acquireRelease(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(AccountTable)
        .values({
          id: AccountV2.ID.make("account-test"),
          email: "test@example.com",
          url: "https://console.example.com",
          access_token: AccountV2.AccessToken.make("access"),
          refresh_token: AccountV2.RefreshToken.make("refresh"),
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()
        .pipe(Effect.orDie)
      return "account-test"
    }),
    (id) =>
      Database.Service.use(({ db }) =>
        db
          .delete(AccountTable)
          .where(eq(AccountTable.id, AccountV2.ID.make(id)))
          .run()
          .pipe(Effect.orDie),
      ),
  )
}

function setSessionUpdated(session: Session.Info, updated: number) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .update(SessionTable)
      .set({ time_updated: updated })
      .where(eq(SessionTable.id, session.id))
      .run()
      .pipe(Effect.orDie)
  })
}

const parentTaskResult = Effect.fn("ExperimentalHttpApiTest.parentTaskResult")(function* (sessionID: SessionID) {
  const messages = yield* Session.use.messages({ sessionID })
  const text = messages
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
  if (!text.includes("<task ")) return yield* Effect.fail(new Error("background result not injected yet"))
  return text
})

function withCreatedWorktree(
  directory: string,
  use: (info: Worktree.Info) => Effect.Effect<void, unknown, HttpClient.HttpClient>,
) {
  const name = "api-test"
  const headers = { "content-type": "application/json" }
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const ready = yield* waitReady({ name }).pipe(Effect.forkScoped)
      const created = yield* request(ExperimentalPaths.worktree, directory, {
        method: "POST",
        headers,
        body: JSON.stringify({ name }),
      })

      expect(created.status).toBe(200)
      const info = yield* json<Worktree.Info>(created)
      expect(info).toMatchObject({ name, branch: "opencode/api-test" })
      yield* Fiber.join(ready)
      return info
    }),
    use,
    (info) =>
      Effect.gen(function* () {
        const removed = yield* request(ExperimentalPaths.worktree, directory, {
          method: "DELETE",
          headers,
          body: JSON.stringify({ directory: info.directory }),
        })
        if (removed.status !== 200) return yield* Effect.fail(new Error(`failed to remove worktree: ${removed.status}`))
        const ok = yield* json<boolean>(removed)
        if (!ok) return yield* Effect.fail(new Error(`failed to remove worktree ${info.directory}`))
      }),
  )
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("experimental HttpApi", () => {
  it.instance(
    "serves read-only experimental endpoints through the default server app",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const directory = tmp.directory
        const [consoleState, consoleOrgs, toolList, toolIDs, worktrees, backgroundJobs, resources] = yield* Effect.all(
          [
            request(ExperimentalPaths.console, directory),
            request(ExperimentalPaths.consoleOrgs, directory),
            request(`${ExperimentalPaths.tool}?provider=opencode&model=gpt-5`, directory),
            request(ExperimentalPaths.toolIDs, directory),
            request(ExperimentalPaths.worktree, directory),
            request(ExperimentalPaths.sessionBackgroundJobs, directory),
            request(ExperimentalPaths.resource, directory),
          ],
          { concurrency: "unbounded" },
        )

        expect(consoleState.status).toBe(200)
        expect(yield* json(consoleState)).toEqual({
          consoleManagedProviders: [],
          switchableOrgCount: 0,
        })

        expect(consoleOrgs.status).toBe(200)
        expect(yield* json(consoleOrgs)).toEqual({ orgs: [] })

        expect(toolList.status).toBe(200)
        expect(yield* json<unknown[]>(toolList)).toContainEqual(
          expect.objectContaining({
            id: "bash",
            description: expect.any(String),
            parameters: expect.any(Object),
          }),
        )

        expect(toolIDs.status).toBe(200)
        expect(yield* json(toolIDs)).toContain("bash")

        expect(worktrees.status).toBe(200)
        expect(yield* json(worktrees)).toEqual([])

        expect(backgroundJobs.status).toBe(200)
        expect(yield* json(backgroundJobs)).toEqual([])

        expect(resources.status).toBe(200)
        expect(yield* json(resources)).toEqual({})
      }),
    {
      config: {
        formatter: false,
        lsp: false,
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    },
  )

  it.instance("persists background task job snapshots on the child session", () =>
    Effect.gen(function* () {
      const tmp = yield* TestInstance
      const parent = yield* createSession({ title: "parent" })
      const child = yield* createSession({ parentID: parent.id, title: "Research auth (@researcher subagent)" })
      const jobs = yield* BackgroundJob.Service
      const job = yield* jobs.start({
        id: child.id,
        type: "task",
        title: "Research auth",
        metadata: { sessionId: child.id, parentSessionId: parent.id },
        run: Effect.succeed("Use OAuth."),
      })
      yield* jobs.wait({ id: job.id })

      const stored = yield* Session.use.get(child.id)
      expect(stored.metadata?.backgroundTaskJob).toMatchObject({
        id: child.id,
        sessionID: child.id,
        parentSessionID: parent.id,
        status: "completed",
        output: "Use OAuth.",
      })

      const response = yield* request(ExperimentalPaths.sessionBackgroundJobs, tmp.directory)
      expect(response.status).toBe(200)
      expect(yield* json(response)).toContainEqual(
        expect.objectContaining({
          id: child.id,
          status: "completed",
          output: "Use OAuth.",
          updatedAt: expect.any(Number),
        }),
      )
    }),
  )

  it.instance("reports durable orphaned running background tasks as stopped after restart", () =>
    Effect.gen(function* () {
      const tmp = yield* TestInstance
      const parent = yield* createSession({ title: "parent" })
      const child = yield* createSession({ parentID: parent.id, title: "Research auth (@researcher subagent)" })
      yield* Session.use.setMetadata({
        sessionID: child.id,
        metadata: {
          backgroundTaskJob: {
            id: child.id,
            sessionID: child.id,
            parentSessionID: parent.id,
            status: "running",
            title: "Research auth",
            startedAt: 10,
            updatedAt: 20,
          },
        },
      })

      const response = yield* request(ExperimentalPaths.sessionBackgroundJobs, tmp.directory)

      expect(response.status).toBe(200)
      expect(yield* json(response)).toContainEqual({
        id: child.id,
        sessionID: child.id,
        parentSessionID: parent.id,
        status: "error",
        title: "Research auth",
        startedAt: 10,
        updatedAt: 20,
        completedAt: 20,
        retryable: true,
        error: "Background task stopped before completion because Cedric restarted.",
      })
    }),
  )

  it.live("retries durable orphaned background tasks in the same child session", () =>
    provideTmpdirServer(
      ({ dir, llm }) =>
        Effect.gen(function* () {
          yield* llm.text("Recovered background result.", { usage: { input: 1, output: 1 } })
          const parent = yield* createSession({ title: "parent" })
          const child = yield* createSession({
            parentID: parent.id,
            title: "Research auth (@build subagent)",
            agent: "build",
          })
          yield* Session.use.setMetadata({
            sessionID: child.id,
            metadata: {
              backgroundTaskJob: {
                id: child.id,
                sessionID: child.id,
                parentSessionID: parent.id,
                status: "running",
                title: "Research auth",
                startedAt: 10,
                updatedAt: 20,
                model: { providerID: "test", modelID: "test-model" },
              },
            },
          })

          const response = yield* request(ExperimentalPaths.sessionBackgroundJobRetry.replace(":sessionID", child.id), dir, {
            method: "POST",
          })

          expect(response.status).toBe(200)
          expect(yield* json(response)).toMatchObject({
            id: child.id,
            sessionID: child.id,
            parentSessionID: parent.id,
            status: "running",
            model: { providerID: "test", modelID: "test-model" },
          })
          const waited = yield* (yield* BackgroundJob.Service).wait({ id: child.id, timeout: 2_000 })
          expect(waited.timedOut).toBe(false)
          expect(waited.info?.status).toBe("completed")
          expect(waited.info?.output).toBe("Recovered background result.")
          const stored = yield* Effect.gen(function* () {
            const value = yield* Session.use.get(child.id)
            if (
              value.metadata?.backgroundTaskJob &&
              typeof value.metadata.backgroundTaskJob === "object" &&
              "status" in value.metadata.backgroundTaskJob &&
              value.metadata.backgroundTaskJob.status === "completed"
            ) {
              return value
            }
            return yield* Effect.fail(new Error("completed background task metadata not persisted yet"))
          }).pipe(Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 20 }))
          expect(stored.metadata?.backgroundTaskJob).toMatchObject({
            id: child.id,
            status: "completed",
            output: "Recovered background result.",
          })
          const injected = yield* parentTaskResult(parent.id).pipe(
            Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 20 }),
          )
          expect(injected).toContain("Recovered background result.")
        }),
      { git: true, config: testProviderConfig },
    ).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(CrossSpawnSpawner.defaultLayer)),
  )

  it.instance("returns declared worktree errors", () =>
    Effect.gen(function* () {
      const tmp = yield* TestInstance
      const response = yield* request(ExperimentalPaths.worktree, tmp.directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(400)
      expect(yield* json(response)).toEqual({
        name: "WorktreeNotGitError",
        data: { message: "Worktrees are only supported for git projects" },
      })
    }),
  )

  it.instance(
    "serves Console org switch through the default server app",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const accountID = yield* insertAccount()
        const switched = yield* request(ExperimentalPaths.consoleSwitch, tmp.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountID, orgID: "org-test" }),
        })

        expect(switched.status).toBe(200)
        expect(yield* json(switched)).toBe(true)
      }),
    { config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves global session list through the default server app",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const first = yield* createSession({ title: "page-one" })
        const second = yield* createSession({ title: "page-two" })
        yield* setSessionUpdated(first, 1)
        yield* setSessionUpdated(second, 2)

        const page = yield* request(
          `${ExperimentalPaths.session}?${new URLSearchParams({ directory: tmp.directory, limit: "1" })}`,
          tmp.directory,
        )
        expect(page.status).toBe(200)
        expect(page.headers["x-next-cursor"]).toBeTruthy()

        const body = yield* json<Session.GlobalInfo[]>(page)
        expect(body.map((session) => session.id)).toEqual([second.id])
        expect(body[0].project?.id).toBe(second.projectID)

        const next = yield* request(
          `${ExperimentalPaths.session}?${new URLSearchParams({
            directory: tmp.directory,
            limit: "10",
            cursor: body[0].time.updated.toString(),
          })}`,
          tmp.directory,
        )
        expect(next.status).toBe(200)
        expect((yield* json<Session.GlobalInfo[]>(next)).map((session) => session.id)).toContain(first.id)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  testWorktreeMutations(
    "serves worktree mutations through the default server app",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        yield* withCreatedWorktree(tmp.directory, (info) =>
          Effect.gen(function* () {
            const listed = yield* request(ExperimentalPaths.worktree, tmp.directory)
            expect(listed.status).toBe(200)
            expect(yield* json(listed)).toContain(info.directory)

            const reset = yield* request(ExperimentalPaths.worktreeReset, tmp.directory, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ directory: info.directory }),
            })

            expect(reset.status).toBe(200)
            expect(yield* json(reset)).toBe(true)
          }),
        )

        const afterRemove = yield* request(ExperimentalPaths.worktree, tmp.directory)
        expect(afterRemove.status).toBe(200)
        expect(yield* json(afterRemove)).toEqual([])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
