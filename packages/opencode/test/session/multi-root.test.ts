import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Schema } from "effect"
import { Session as SessionNs } from "../../src/session"
import { Log } from "../../src/util"
import { Instance } from "../../src/project/instance"
import { AppRuntime } from "../../src/effect/app-runtime"
import { MultiRootWorkspaceID } from "../../src/workspace/schema"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

function create(input?: SessionNs.CreateInput) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create(input)))
}

describe("Session.multiRootWorkspaceID", () => {
  test("round-trips multiRootWorkspaceID through create + get", async () => {
    await using tmp = await tmpdir({ git: true })
    const mrwID = Schema.decodeUnknownSync(MultiRootWorkspaceID)(crypto.randomUUID())

    await Instance.provide({
      directory: tmp.path,
      multiRootWorkspaceID: mrwID,
      roots: [tmp.path],
      fn: async () => {
        const created = await create({})
        expect(created.multiRootWorkspaceID).toBe(mrwID)

        const fetched = await AppRuntime.runPromise(SessionNs.Service.use((s) => s.get(created.id)))
        expect(fetched?.multiRootWorkspaceID).toBe(mrwID)
      },
    })
  })

  test("create without an active multi-root workspace leaves field undefined", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const created = await create({})
        expect(created.multiRootWorkspaceID).toBeUndefined()
      },
    })
  })

  test("explicit input.multiRootWorkspaceID overrides instance default", async () => {
    await using tmp = await tmpdir({ git: true })
    const mrwA = Schema.decodeUnknownSync(MultiRootWorkspaceID)(crypto.randomUUID())
    const mrwB = Schema.decodeUnknownSync(MultiRootWorkspaceID)(crypto.randomUUID())

    await Instance.provide({
      directory: tmp.path,
      multiRootWorkspaceID: mrwA,
      fn: async () => {
        const created = await create({ multiRootWorkspaceID: mrwB })
        expect(created.multiRootWorkspaceID).toBe(mrwB)
      },
    })
  })
})

describe("Instance.roots + containsPath", () => {
  test("containsPath returns true for paths inside any root", async () => {
    await using primary = await tmpdir({ git: true })
    await using secondary = await tmpdir({ git: true })

    await Instance.provide({
      directory: primary.path,
      roots: [primary.path, secondary.path],
      fn: async () => {
        expect(Instance.roots).toContain(primary.path)
        expect(Instance.roots).toContain(secondary.path)

        expect(Instance.containsPath(path.join(primary.path, "foo.ts"))).toBe(true)
        expect(Instance.containsPath(path.join(secondary.path, "foo.ts"))).toBe(true)
      },
    })
  })

  test("containsPath returns false for paths outside all roots (non-worktree scope)", async () => {
    await using primary = await tmpdir({ git: true })
    await using other = await tmpdir({ git: true })

    await Instance.provide({
      directory: primary.path,
      roots: [primary.path],
      fn: async () => {
        expect(Instance.containsPath(path.join(other.path, "bar.ts"))).toBe(false)
      },
    })
  })

  test("instance cache differentiates single- vs multi-root for the same directory", async () => {
    await using primary = await tmpdir({ git: true })
    await using secondary = await tmpdir({ git: true })

    const single = await Instance.provide({
      directory: primary.path,
      fn: async () => Instance.roots.slice(),
    })
    expect(single).toEqual([primary.path])

    const multi = await Instance.provide({
      directory: primary.path,
      roots: [primary.path, secondary.path],
      fn: async () => Instance.roots.slice(),
    })
    expect(multi).toContain(primary.path)
    expect(multi).toContain(secondary.path)
  })
})
