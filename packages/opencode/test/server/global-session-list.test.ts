import { describe, expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import { Project } from "@/project/project"
import { Session as SessionNs } from "@/session/session"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Log from "@opencode-ai/core/util/log"
import { provideInstance, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const it = testEffect(Layer.mergeAll(SessionNs.defaultLayer, Project.defaultLayer, CrossSpawnSpawner.defaultLayer))

const withSession = (input?: Parameters<SessionNs.Interface["create"]>[0]) =>
  Effect.acquireRelease(
    SessionNs.Service.use((session) => session.create(input)),
    (created) => SessionNs.Service.use((session) => session.remove(created.id).pipe(Effect.ignore)),
  )

describe("session.listGlobal", () => {
  it.instance(
    "lists sessions across projects with project metadata",
    () =>
      Effect.gen(function* () {
        const first = yield* TestInstance
        const second = yield* tmpdirScoped({ git: true })

        const firstSession = yield* withSession({ title: "first-session" })
        const secondSession = yield* withSession({ title: "second-session" }).pipe(provideInstance(second))

        const sessions = yield* Effect.sync(() => [...SessionNs.listGlobal({ limit: 200 })])
        const ids = sessions.map((session) => session.id)

        expect(ids).toContain(firstSession.id)
        expect(ids).toContain(secondSession.id)

        const firstProject = yield* Project.Service.use((project) => project.get(firstSession.projectID))
        const secondProject = yield* Project.Service.use((project) => project.get(secondSession.projectID))

        const firstItem = sessions.find((session) => session.id === firstSession.id)
        const secondItem = sessions.find((session) => session.id === secondSession.id)

        expect(firstItem?.project?.id).toBe(firstProject?.id)
        expect(firstItem?.project?.worktree).toBe(firstProject?.worktree)
        expect(secondItem?.project?.id).toBe(secondProject?.id)
        expect(secondItem?.project?.worktree).toBe(secondProject?.worktree)
        expect(first.directory).not.toBe(second)
      }),
    { git: true },
  )

  it.instance(
    "excludes archived sessions by default",
    () =>
      Effect.gen(function* () {
        const archived = yield* withSession({ title: "archived-session" })

        yield* SessionNs.Service.use((session) => session.setArchived({ sessionID: archived.id, time: Date.now() }))

        const sessions = yield* Effect.sync(() => [...SessionNs.listGlobal({ limit: 200 })])
        const ids = sessions.map((session) => session.id)

        expect(ids).not.toContain(archived.id)

        const allSessions = yield* Effect.sync(() => [...SessionNs.listGlobal({ limit: 200, archived: true })])
        const allIds = allSessions.map((session) => session.id)

        expect(allIds).toContain(archived.id)
      }),
    { git: true },
  )

  it.instance(
    "supports cursor pagination",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance

        const first = yield* withSession({ title: "page-one" })
        const ready = yield* Deferred.make<void>()
        yield* Deferred.succeed(ready, undefined).pipe(Effect.delay("5 millis"), Effect.forkScoped)
        yield* Deferred.await(ready).pipe(
          Effect.timeoutOrElse({
            duration: "1 second",
            orElse: () => Effect.fail(new Error("timed out waiting between session creates")),
          }),
        )
        const second = yield* withSession({ title: "page-two" })

        const page = yield* Effect.sync(() => [...SessionNs.listGlobal({ directory: test.directory, limit: 1 })])
        expect(page.length).toBe(1)
        expect(page[0].id).toBe(second.id)

        const next = yield* Effect.sync(() => [
          ...SessionNs.listGlobal({ directory: test.directory, limit: 10, cursor: page[0].time.updated }),
        ])
        const ids = next.map((session) => session.id)

        expect(ids).toContain(first.id)
        expect(ids).not.toContain(second.id)
      }),
    { git: true },
  )
})
