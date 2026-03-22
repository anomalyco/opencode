import { $ } from "bun"
import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

function withInstance(directory: string, fn: () => Promise<any>) {
  return Instance.provide({ directory, fn })
}

describe("Worktree", () => {
  afterEach(() => Instance.disposeAll())

  describe("makeWorktreeInfo", () => {
    test("returns info with name, branch, and directory", async () => {
      await using tmp = await tmpdir({ git: true })

      const info = await withInstance(tmp.path, () => Worktree.makeWorktreeInfo())

      expect(info.name).toBeDefined()
      expect(typeof info.name).toBe("string")
      expect(info.branch).toBe(`opencode/${info.name}`)
      expect(info.directory).toContain(info.name)
    })

    test("uses provided name as base", async () => {
      await using tmp = await tmpdir({ git: true })

      const info = await withInstance(tmp.path, () => Worktree.makeWorktreeInfo("my-feature"))

      expect(info.name).toBe("my-feature")
      expect(info.branch).toBe("opencode/my-feature")
    })

    test("slugifies the provided name", async () => {
      await using tmp = await tmpdir({ git: true })

      const info = await withInstance(tmp.path, () => Worktree.makeWorktreeInfo("My Feature Branch!"))

      expect(info.name).toBe("my-feature-branch")
    })

    test("throws NotGitError for non-git directories", async () => {
      await using tmp = await tmpdir()

      await expect(
        withInstance(tmp.path, () => Worktree.makeWorktreeInfo()),
      ).rejects.toThrow("WorktreeNotGitError")
    })
  })

  describe("create + remove lifecycle", () => {
    test("create returns worktree info and remove cleans up", async () => {
      await using tmp = await tmpdir({ git: true })

      const info = await withInstance(tmp.path, () => Worktree.create())

      expect(info.name).toBeDefined()
      expect(info.branch).toStartWith("opencode/")
      expect(info.directory).toBeDefined()

      // Worktree directory should exist after bootstrap
      await Bun.sleep(500)

      const ok = await withInstance(tmp.path, () => Worktree.remove({ directory: info.directory }))
      expect(ok).toBe(true)

      // Directory should be cleaned up
      const exists = await fs.stat(info.directory).then(() => true).catch(() => false)
      expect(exists).toBe(false)

      // Branch should be deleted
      const ref = await $`git show-ref --verify --quiet refs/heads/${info.branch}`.cwd(tmp.path).quiet().nothrow()
      expect(ref.exitCode).not.toBe(0)
    })

    test("create returns info immediately and fires Event.Ready after bootstrap", async () => {
      await using tmp = await tmpdir({ git: true })
      const { GlobalBus } = await import("../../src/bus/global")

      const ready = new Promise<{ name: string; branch: string }>((resolve, reject) => {
        const timer = setTimeout(() => {
          GlobalBus.off("event", on)
          reject(new Error("timed out waiting for worktree.ready"))
        }, 10_000)

        function on(evt: { directory?: string; payload: { type: string; properties: any } }) {
          if (evt.payload.type !== Worktree.Event.Ready.type) return
          clearTimeout(timer)
          GlobalBus.off("event", on)
          resolve(evt.payload.properties)
        }

        GlobalBus.on("event", on)
      })

      const info = await withInstance(tmp.path, () => Worktree.create())

      // create returns immediately — info is available before bootstrap completes
      expect(info.name).toBeDefined()
      expect(info.branch).toStartWith("opencode/")

      // Event.Ready fires after bootstrap finishes in the background
      const props = await ready
      expect(props.name).toBe(info.name)
      expect(props.branch).toBe(info.branch)

      // Cleanup
      await Bun.sleep(100)
      await withInstance(tmp.path, () => Worktree.remove({ directory: info.directory }))
    })

    test("create with custom name", async () => {
      await using tmp = await tmpdir({ git: true })

      const info = await withInstance(tmp.path, () => Worktree.create({ name: "test-workspace" }))

      expect(info.name).toBe("test-workspace")
      expect(info.branch).toBe("opencode/test-workspace")

      // Cleanup
      await withInstance(tmp.path, () => Worktree.remove({ directory: info.directory }))
    })
  })

  describe("createFromInfo", () => {
    test("creates and bootstraps git worktree", async () => {
      await using tmp = await tmpdir({ git: true })

      const info = await withInstance(tmp.path, () => Worktree.makeWorktreeInfo("from-info-test"))
      await withInstance(tmp.path, () => Worktree.createFromInfo(info))

      // Worktree should exist in git
      const list = await $`git worktree list --porcelain`.cwd(tmp.path).quiet().text()
      expect(list).toContain(info.directory)

      // Cleanup
      await withInstance(tmp.path, () => Worktree.remove({ directory: info.directory }))
    })
  })

  describe("remove edge cases", () => {
    test("remove non-existent directory succeeds silently", async () => {
      await using tmp = await tmpdir({ git: true })

      const ok = await withInstance(tmp.path, () =>
        Worktree.remove({ directory: path.join(tmp.path, "does-not-exist") }),
      )
      expect(ok).toBe(true)
    })

    test("throws NotGitError for non-git directories", async () => {
      await using tmp = await tmpdir()

      await expect(
        withInstance(tmp.path, () => Worktree.remove({ directory: "/tmp/fake" })),
      ).rejects.toThrow("WorktreeNotGitError")
    })
  })
})
