import { describe, test, expect, afterEach } from "bun:test"
import { GitContext } from "../../src/git/context"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("GitContext.get", () => {
  test("returns empty string for non-git directory", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const text = await GitContext.get()
        expect(text).toBe("")
      },
    })
  })

  test("returns branch info for git repo", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        GitContext.invalidate(tmp.path)
        const text = await GitContext.get()
        expect(text).toContain("Branch:")
      },
    })
  })

  test("caches results — second call is same as first", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        GitContext.invalidate(tmp.path)
        const a = await GitContext.get()
        const b = await GitContext.get()
        expect(a).toBe(b)
      },
    })
  })

  test("invalidate clears the cache", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        GitContext.invalidate(tmp.path)
        await GitContext.get()
        GitContext.invalidate(tmp.path)
        // Should re-fetch (no error)
        const text = await GitContext.get()
        expect(typeof text).toBe("string")
      },
    })
  })
})

describe("GitContext.section", () => {
  test("returns undefined for non-git directory", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        GitContext.invalidate(tmp.path)
        const sec = await GitContext.section()
        expect(sec).toBeUndefined()
      },
    })
  })

  test("returns formatted section for git repo", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        GitContext.invalidate(tmp.path)
        const sec = await GitContext.section()
        expect(sec).toContain("<git_context>")
        expect(sec).toContain("</git_context>")
      },
    })
  })
})
