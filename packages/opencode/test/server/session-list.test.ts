import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Session as SessionNs } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { disposeAllInstances, provideInstance, TestInstance } from "../fixture/fixture"
import { mkdir } from "fs/promises"
import path from "path"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { eq } from "drizzle-orm"
import { testEffect } from "../lib/effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Storage } from "@/storage/storage"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BackgroundJob } from "@/background/job"

void Log.init({ print: false })
const it = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    SessionNs.layer.pipe(
      Layer.provide(EventV2Bridge.defaultLayer),
      Layer.provide(Storage.defaultLayer),
      Layer.provide(Database.defaultLayer),
      Layer.provide(EventV2Bridge.defaultLayer),
      Layer.provide(SessionProjector.defaultLayer),
      Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
      Layer.provide(BackgroundJob.defaultLayer),
    ),
  ),
)

const withSession = (input?: Parameters<SessionNs.Interface["create"]>[0]) =>
  Effect.acquireRelease(SessionNs.use.create(input), (created) =>
    SessionNs.Service.use((session) => session.remove(created.id).pipe(Effect.ignore)),
  )

afterEach(async () => {
  await disposeAllInstances()
})

describe("session.list", () => {
  it.instance(
    "does not filter by directory when directory is omitted",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => mkdir(path.join(test.directory, "packages", "opencode"), { recursive: true }))
        yield* Effect.promise(() => mkdir(path.join(test.directory, "packages", "app"), { recursive: true }))

        const root = yield* withSession({ title: "root" })
        const parent = yield* withSession({ title: "parent" }).pipe(
          provideInstance(path.join(test.directory, "packages")),
        )
        const current = yield* withSession({ title: "current" }).pipe(
          provideInstance(path.join(test.directory, "packages", "opencode")),
        )
        const sibling = yield* withSession({ title: "sibling" }).pipe(
          provideInstance(path.join(test.directory, "packages", "app")),
        )

        const ids = (yield* SessionNs.use.list()).map((session) => session.id)
        expect(ids).toContain(root.id)
        expect(ids).toContain(parent.id)
        expect(ids).toContain(current.id)
        expect(ids).toContain(sibling.id)
      }),
    { git: true },
  )

  it.instance(
    "filters by directory when directory is provided",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => mkdir(path.join(test.directory, "packages", "opencode"), { recursive: true }))
        yield* Effect.promise(() => mkdir(path.join(test.directory, "packages", "app"), { recursive: true }))

        const root = yield* withSession({ title: "root" })
        const parent = yield* withSession({ title: "parent" }).pipe(
          provideInstance(path.join(test.directory, "packages")),
        )
        const current = yield* withSession({ title: "current" }).pipe(
          provideInstance(path.join(test.directory, "packages", "opencode")),
        )
        const sibling = yield* withSession({ title: "sibling" }).pipe(
          provideInstance(path.join(test.directory, "packages", "app")),
        )

        const ids = (yield* SessionNs.Service.use((session) =>
          session.list({ directory: path.join(test.directory, "packages", "opencode") }),
        )).map((session) => session.id)
        expect(ids).not.toContain(root.id)
        expect(ids).not.toContain(parent.id)
        expect(ids).toContain(current.id)
        expect(ids).not.toContain(sibling.id)
      }),
    { git: true },
  )

  it.instance(
    "matches a session regardless of directory separator on Windows",
    () =>
      Effect.gen(function* () {
        if (process.platform !== "win32") return
        const test = yield* TestInstance
        const dir = path.join(test.directory, "packages", "opencode")
        yield* Effect.promise(() => mkdir(dir, { recursive: true }))

        const created = yield* withSession({ title: "separator" }).pipe(provideInstance(dir))

        // A forward-slash query (e.g. from the SDK/HTTP layer) must still find it —
        // this is the regression: backslash-stored vs forward-slash-queried.
        const forwardIDs = (yield* SessionNs.Service.use((session) =>
          session.list({ directory: dir.replaceAll("\\", "/") }),
        )).map((session) => session.id)
        expect(forwardIDs).toContain(created.id)

        // The native form must keep matching too.
        const nativeIDs = (yield* SessionNs.Service.use((session) => session.list({ directory: dir }))).map(
          (session) => session.id,
        )
        expect(nativeIDs).toContain(created.id)
      }),
    { git: true },
  )

  it.instance(
    "filters by path and ignores directory when path is provided",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() =>
          mkdir(path.join(test.directory, "packages", "opencode", "src", "deep"), { recursive: true }),
        )
        yield* Effect.promise(() => mkdir(path.join(test.directory, "packages", "app"), { recursive: true }))

        const parent = yield* withSession({ title: "parent" }).pipe(
          provideInstance(path.join(test.directory, "packages", "opencode")),
        )
        const current = yield* withSession({ title: "current" }).pipe(
          provideInstance(path.join(test.directory, "packages", "opencode", "src")),
        )
        const deeper = yield* withSession({ title: "deeper" }).pipe(
          provideInstance(path.join(test.directory, "packages", "opencode", "src", "deep")),
        )
        const sibling = yield* withSession({ title: "sibling" }).pipe(
          provideInstance(path.join(test.directory, "packages", "app")),
        )

        const pathIDs = (yield* SessionNs.Service.use((session) =>
          session.list({
            directory: path.join(test.directory, "packages", "app"),
            path: "packages/opencode/src",
          }),
        )).map((session) => session.id)
        expect(pathIDs).not.toContain(parent.id)
        expect(pathIDs).toContain(current.id)
        expect(pathIDs).toContain(deeper.id)
        expect(pathIDs).not.toContain(sibling.id)

        if (process.platform === "win32") {
          const windowsPathIDs = (yield* SessionNs.Service.use((session) =>
            session.list({ path: "packages\\opencode\\src" }),
          )).map((session) => session.id)
          expect(windowsPathIDs).toContain(current.id)
          expect(windowsPathIDs).toContain(deeper.id)
        }
      }),
    { git: true },
  )

  it.instance(
    "falls back to directory when filtering legacy sessions without path",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() =>
          mkdir(path.join(test.directory, "packages", "opencode", "src"), { recursive: true }),
        )
        yield* Effect.promise(() => mkdir(path.join(test.directory, "packages", "app"), { recursive: true }))

        const current = yield* withSession({ title: "legacy-current" }).pipe(
          provideInstance(path.join(test.directory, "packages", "opencode", "src")),
        )
        const sibling = yield* withSession({ title: "legacy-sibling" }).pipe(
          provideInstance(path.join(test.directory, "packages", "app")),
        )

        const { db } = yield* Database.Service
        yield* db
          .update(SessionTable)
          .set({ path: null })
          .where(eq(SessionTable.id, current.id))
          .run()
          .pipe(Effect.orDie)
        yield* db
          .update(SessionTable)
          .set({ path: null })
          .where(eq(SessionTable.id, sibling.id))
          .run()
          .pipe(Effect.orDie)

        const pathIDs = (yield* SessionNs.Service.use((session) =>
          session.list({
            directory: path.join(test.directory, "packages", "opencode", "src"),
            path: "packages/opencode/src",
          }),
        )).map((session) => session.id)
        expect(pathIDs).toContain(current.id)
        expect(pathIDs).not.toContain(sibling.id)
      }),
    { git: true },
  )

  it.instance(
    "filters root sessions",
    () =>
      Effect.gen(function* () {
        const root = yield* withSession({ title: "root-session" })
        const child = yield* withSession({ title: "child-session", parentID: root.id })

        const sessions = yield* SessionNs.use.list({ roots: true })
        const ids = sessions.map((session) => session.id)

        expect(ids).toContain(root.id)
        expect(ids).not.toContain(child.id)
      }),
    { git: true },
  )

  it.instance(
    "filters by start time",
    () =>
      Effect.gen(function* () {
        yield* withSession({ title: "new-session" })
        const sessions = yield* SessionNs.Service.use((session) => session.list({ start: Date.now() + 86400000 }))
        expect(sessions.length).toBe(0)
      }),
    { git: true },
  )

  it.instance(
    "filters by search term",
    () =>
      Effect.gen(function* () {
        yield* withSession({ title: "unique-search-term-abc" })
        yield* withSession({ title: "other-session-xyz" })

        const sessions = yield* SessionNs.use.list({ search: "unique-search" })
        const titles = sessions.map((session) => session.title)

        expect(titles).toContain("unique-search-term-abc")
        expect(titles).not.toContain("other-session-xyz")
      }),
    { git: true },
  )

  it.instance(
    "respects limit parameter",
    () =>
      Effect.gen(function* () {
        yield* withSession({ title: "session-1" })
        yield* withSession({ title: "session-2" })
        yield* withSession({ title: "session-3" })

        const sessions = yield* SessionNs.use.list({ limit: 2 })
        expect(sessions.length).toBe(2)
      }),
    { git: true },
  )

  it.instance(
    "includes metadata in listed sessions",
    () =>
      Effect.gen(function* () {
        const meta = { source: "sdk", trace: { id: "abc" } }
        const created = yield* withSession({ title: "meta-session", metadata: meta })

        const listed = (yield* SessionNs.Service.use((session) => session.list({ search: "meta-session" }))).find(
          (item) => item.id === created.id,
        )

        expect(listed?.metadata).toEqual(meta)
      }),
    { git: true },
  )
})
