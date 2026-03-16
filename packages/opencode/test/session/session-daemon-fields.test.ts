import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await resetDatabase()
})

Log.init({ print: false })

describe("session daemon fields", () => {
  test("create persists providerID and modelID", async () => {
    await using tmp = await tmpdir({ git: true })
    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ providerID: "anthropic", modelID: "claude-4" }),
    })
    const fetched = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.get(session.id),
    })
    expect(fetched.providerID).toBe("anthropic")
    expect(fetched.modelID).toBe("claude-4")
  })

  test("create persists git metadata fields", async () => {
    await using tmp = await tmpdir({ git: true })
    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        Session.create({
          gitBranch: "feat/test",
          gitWorktree: "/tmp/worktree",
          prReference: "PR #42",
        }),
    })
    const fetched = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.get(session.id),
    })
    expect(fetched.gitBranch).toBe("feat/test")
    expect(fetched.gitWorktree).toBe("/tmp/worktree")
    expect(fetched.prReference).toBe("PR #42")
  })

  test("create persists displayName", async () => {
    await using tmp = await tmpdir({ git: true })
    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ displayName: "My Task" }),
    })
    const fetched = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.get(session.id),
    })
    expect(fetched.displayName).toBe("My Task")
  })

  test("create without optional fields returns undefined", async () => {
    await using tmp = await tmpdir({ git: true })
    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({}),
    })
    const fetched = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.get(session.id),
    })
    expect(fetched.providerID).toBeUndefined()
    expect(fetched.modelID).toBeUndefined()
    expect(fetched.gitBranch).toBeUndefined()
    expect(fetched.gitWorktree).toBeUndefined()
    expect(fetched.prReference).toBeUndefined()
    expect(fetched.displayName).toBeUndefined()
  })
})
