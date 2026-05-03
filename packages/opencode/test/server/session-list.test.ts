import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import { Session as SessionNs } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { Flag } from "@opencode-ai/core/flag/flag"
import { mkdir } from "fs/promises"
import path from "path"
import { Database } from "@/storage/db"
import { SessionTable } from "@/session/session.sql"
import { eq } from "drizzle-orm"

void Log.init({ print: false })
const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  ...SessionNs,
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((svc) => svc.create(input)))
  },
  list(input?: SessionNs.ListInput) {
    return run(SessionNs.Service.use((svc) => svc.list(input)))
  },
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  await disposeAllInstances()
})

describe("session.list", () => {
  test("does not filter by directory when directory is omitted", async () => {
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = false
    await using tmp = await tmpdir({ git: true })
    await mkdir(path.join(tmp.path, "packages", "opencode"), { recursive: true })
    await mkdir(path.join(tmp.path, "packages", "app"), { recursive: true })

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await svc.create({ title: "root" })

        const parent = await WithInstance.provide({
          directory: path.join(tmp.path, "packages"),
          fn: async () => svc.create({ title: "parent" }),
        })
        const current = await WithInstance.provide({
          directory: path.join(tmp.path, "packages", "opencode"),
          fn: async () => svc.create({ title: "current" }),
        })
        const sibling = await WithInstance.provide({
          directory: path.join(tmp.path, "packages", "app"),
          fn: async () => svc.create({ title: "sibling" }),
        })

        const ids = (await svc.list()).map((s) => s.id)
        expect(ids).toContain(root.id)
        expect(ids).toContain(parent.id)
        expect(ids).toContain(current.id)
        expect(ids).toContain(sibling.id)
      },
    })
  })

  test("filters by directory when directory is provided", async () => {
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = false
    await using tmp = await tmpdir({ git: true })
    await mkdir(path.join(tmp.path, "packages", "opencode"), { recursive: true })
    await mkdir(path.join(tmp.path, "packages", "app"), { recursive: true })

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await svc.create({ title: "root" })

        const parent = await WithInstance.provide({
          directory: path.join(tmp.path, "packages"),
          fn: async () => svc.create({ title: "parent" }),
        })
        const current = await WithInstance.provide({
          directory: path.join(tmp.path, "packages", "opencode"),
          fn: async () => svc.create({ title: "current" }),
        })
        const sibling = await WithInstance.provide({
          directory: path.join(tmp.path, "packages", "app"),
          fn: async () => svc.create({ title: "sibling" }),
        })

        const ids = (await svc.list({ directory: path.join(tmp.path, "packages", "opencode") })).map((s) => s.id)
        expect(ids).not.toContain(root.id)
        expect(ids).not.toContain(parent.id)
        expect(ids).toContain(current.id)
        expect(ids).not.toContain(sibling.id)
      },
    })
  })

  test("filters by path and ignores directory when path is provided", async () => {
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = false
    await using tmp = await tmpdir({ git: true })
    await mkdir(path.join(tmp.path, "packages", "opencode", "src", "deep"), { recursive: true })
    await mkdir(path.join(tmp.path, "packages", "app"), { recursive: true })

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await WithInstance.provide({
          directory: path.join(tmp.path, "packages", "opencode"),
          fn: async () => svc.create({ title: "parent" }),
        })
        const current = await WithInstance.provide({
          directory: path.join(tmp.path, "packages", "opencode", "src"),
          fn: async () => svc.create({ title: "current" }),
        })
        const deeper = await WithInstance.provide({
          directory: path.join(tmp.path, "packages", "opencode", "src", "deep"),
          fn: async () => svc.create({ title: "deeper" }),
        })
        const sibling = await WithInstance.provide({
          directory: path.join(tmp.path, "packages", "app"),
          fn: async () => svc.create({ title: "sibling" }),
        })

        const pathIDs = (
          await svc.list({
            directory: path.join(tmp.path, "packages", "app"),
            path: "packages/opencode/src",
          })
        ).map((s) => s.id)
        expect(pathIDs).not.toContain(parent.id)
        expect(pathIDs).toContain(current.id)
        expect(pathIDs).toContain(deeper.id)
        expect(pathIDs).not.toContain(sibling.id)
      },
    })
  })

  test("falls back to directory when filtering legacy sessions without path", async () => {
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = false
    await using tmp = await tmpdir({ git: true })
    await mkdir(path.join(tmp.path, "packages", "opencode", "src"), { recursive: true })
    await mkdir(path.join(tmp.path, "packages", "app"), { recursive: true })

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const current = await WithInstance.provide({
          directory: path.join(tmp.path, "packages", "opencode", "src"),
          fn: async () => svc.create({ title: "legacy-current" }),
        })
        const sibling = await WithInstance.provide({
          directory: path.join(tmp.path, "packages", "app"),
          fn: async () => svc.create({ title: "legacy-sibling" }),
        })

        Database.use((db) => db.update(SessionTable).set({ path: null }).where(eq(SessionTable.id, current.id)).run())
        Database.use((db) => db.update(SessionTable).set({ path: null }).where(eq(SessionTable.id, sibling.id)).run())

        const pathIDs = (
          await svc.list({
            directory: path.join(tmp.path, "packages", "opencode", "src"),
            path: "packages/opencode/src",
          })
        ).map((s) => s.id)
        expect(pathIDs).toContain(current.id)
        expect(pathIDs).not.toContain(sibling.id)
      },
    })
  })

  test("filters root sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await svc.create({ title: "root-session" })
        const child = await svc.create({ title: "child-session", parentID: root.id })

        const sessions = await svc.list({ roots: true })
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(root.id)
        expect(ids).not.toContain(child.id)
      },
    })
  })

  test("filters by start time", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        await svc.create({ title: "new-session" })
        const futureStart = Date.now() + 86400000

        const sessions = await svc.list({ start: futureStart })
        expect(sessions.length).toBe(0)
      },
    })
  })

  test("filters by search term", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        await svc.create({ title: "unique-search-term-abc" })
        await svc.create({ title: "other-session-xyz" })

        const sessions = await svc.list({ search: "unique-search" })
        const titles = sessions.map((s) => s.title)

        expect(titles).toContain("unique-search-term-abc")
        expect(titles).not.toContain("other-session-xyz")
      },
    })
  })

  test("respects limit parameter", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        await svc.create({ title: "session-1" })
        await svc.create({ title: "session-2" })
        await svc.create({ title: "session-3" })

        const sessions = await svc.list({ limit: 2 })
        expect(sessions.length).toBe(2)
      },
    })
  })
})
