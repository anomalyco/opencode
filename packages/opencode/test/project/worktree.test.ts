import { $ } from "bun"
import { afterEach, describe, expect, test } from "bun:test"

const wintest = process.platform !== "win32" ? test : test.skip
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

function withInstance(directory: string, fn: () => Promise<any>) {
  return Instance.provide({ directory, fn })
}

function normalize(input: string) {
  return input.replace(/\\/g, "/").toLowerCase()
}

async function waitReady() {
  const { GlobalBus } = await import("../../src/bus/global")

  return await new Promise<{ name: string; branch: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      GlobalBus.off("event", on)
      reject(new Error("timed out waiting for worktree.ready"))
    }, 10_000)

    function on(evt: { directory?: string; payload: { type: string; properties: { name: string; branch: string } } }) {
      if (evt.payload.type !== Worktree.Event.Ready.type) return
      clearTimeout(timer)
      GlobalBus.off("event", on)
      resolve(evt.payload.properties)
    }

    GlobalBus.on("event", on)
  })
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

      await expect(withInstance(tmp.path, () => Worktree.makeWorktreeInfo())).rejects.toThrow("WorktreeNotGitError")
    })
  })

  describe("create + remove lifecycle", () => {
    test("create returns worktree info and remove cleans up", async () => {
      await using tmp = await tmpdir({ git: true })

      const info = await withInstance(tmp.path, () => Worktree.create())

      expect(info.name).toBeDefined()
      expect(info.branch).toStartWith("opencode/")
      expect(info.directory).toBeDefined()

      // Wait for bootstrap to complete
      await Bun.sleep(1000)

      const ok = await withInstance(tmp.path, () => Worktree.remove({ directory: info.directory }))
      expect(ok).toBe(true)
    })

    test("create returns after setup and fires Event.Ready after bootstrap", async () => {
      await using tmp = await tmpdir({ git: true })
      const ready = waitReady()

      const info = await withInstance(tmp.path, () => Worktree.create())

      // create returns before bootstrap completes, but the worktree already exists
      expect(info.name).toBeDefined()
      expect(info.branch).toStartWith("opencode/")

      const text = await $`git worktree list --porcelain`.cwd(tmp.path).quiet().text()
      const dir = await fs.realpath(info.directory).catch(() => info.directory)
      expect(normalize(text)).toContain(normalize(dir))

      // Event.Ready fires after bootstrap finishes in the background
      const props = await ready
      expect(props.name).toBe(info.name)
      expect(props.branch).toBe(info.branch)

      // Cleanup
      await withInstance(info.directory, () => Instance.dispose())
      await Bun.sleep(100)
      await withInstance(tmp.path, () => Worktree.remove({ directory: info.directory }))
    })

    test("create worktree before repo has a first commit", async () => {
      await using tmp = await tmpdir()
      await $`git init`.cwd(tmp.path).quiet()
      await $`git config core.fsmonitor false`.cwd(tmp.path).quiet()

      // This repo has no commits yet, so HEAD should not resolve.
      const head = await $`git rev-parse --verify HEAD`.cwd(tmp.path).quiet().nothrow()
      expect(head.exitCode).not.toBe(0)

      const info = await withInstance(tmp.path, () => Worktree.create())

      const text = await $`git worktree list --porcelain`.cwd(tmp.path).quiet().text()
      const dir = await fs.realpath(info.directory).catch(() => info.directory)
      expect(normalize(text)).toContain(normalize(dir))

      const branch = await $`git symbolic-ref --short HEAD`.cwd(info.directory).quiet().text()
      expect(branch.trim()).toBe(info.branch)

      // The new worktree should still be an unborn branch.
      const status = await $`git status --short --branch`.cwd(info.directory).quiet().text()
      expect(status).toContain("No commits yet")

      await withInstance(info.directory, () => Instance.dispose())
      await Bun.sleep(100)
      const ok = await withInstance(tmp.path, () => Worktree.remove({ directory: info.directory }))
      expect(ok).toBe(true)
    })

    test("create with custom name", async () => {
      await using tmp = await tmpdir({ git: true })
      const ready = waitReady()

      const info = await withInstance(tmp.path, () => Worktree.create({ name: "test-workspace" }))

      expect(info.name).toBe("test-workspace")
      expect(info.branch).toBe("opencode/test-workspace")

      // Cleanup
      await ready
      await withInstance(info.directory, () => Instance.dispose())
      await Bun.sleep(100)
      await withInstance(tmp.path, () => Worktree.remove({ directory: info.directory }))
    })
  })

  describe("createFromInfo", () => {
    wintest("creates and bootstraps git worktree", async () => {
      await using tmp = await tmpdir({ git: true })

      const info = await withInstance(tmp.path, () => Worktree.makeWorktreeInfo("from-info-test"))
      await withInstance(tmp.path, () => Worktree.createFromInfo(info))

      // Worktree should exist in git (normalize slashes for Windows)
      const list = await $`git worktree list --porcelain`.cwd(tmp.path).quiet().text()
      const normalizedList = list.replace(/\\/g, "/")
      const normalizedDir = info.directory.replace(/\\/g, "/")
      expect(normalizedList).toContain(normalizedDir)

      // Cleanup
      await withInstance(tmp.path, () => Worktree.remove({ directory: info.directory }))
    })
  })

  describe("reset edge cases", () => {
    test("reset cleans a worktree before first commit", async () => {
      await using tmp = await tmpdir()
      await $`git init`.cwd(tmp.path).quiet()
      await $`git config core.fsmonitor false`.cwd(tmp.path).quiet()
      const ready = waitReady()

      const info = await withInstance(tmp.path, () => Worktree.create())
      await ready

      await fs.writeFile(path.join(info.directory, "dirty.txt"), "dirty\n", "utf-8")

      const ok = await withInstance(tmp.path, () => Worktree.reset({ directory: info.directory }))
      expect(ok).toBe(true)

      const exists = await fs
        .stat(path.join(info.directory, "dirty.txt"))
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(false)

      const branch = await $`git symbolic-ref --short HEAD`.cwd(info.directory).quiet().text()
      expect(branch.trim()).toBe(info.branch)

      await withInstance(info.directory, () => Instance.dispose())
      await Bun.sleep(100)
      await withInstance(tmp.path, () => Worktree.remove({ directory: info.directory }))
    })
  })

  describe("remove edge cases", () => {
    test("remove succeeds for worktrees created before first commit", async () => {
      await using tmp = await tmpdir()
      await $`git init`.cwd(tmp.path).quiet()
      await $`git config core.fsmonitor false`.cwd(tmp.path).quiet()

      const worktreePath = path.join(tmp.path, "..", path.basename(tmp.path) + "-unborn-worktree")
      await $`git worktree add -b unborn-branch ${worktreePath}`.cwd(tmp.path).quiet()

      const ok = await withInstance(tmp.path, () => Worktree.remove({ directory: worktreePath }))
      expect(ok).toBe(true)

      const list = await $`git worktree list --porcelain`.cwd(tmp.path).quiet().text()
      const normalizedList = normalize(list)
      const normalizedDir = normalize(worktreePath)
      expect(normalizedList).not.toContain(normalizedDir)

      const exists = await fs
        .stat(worktreePath)
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(false)
    })

    test("remove non-existent directory succeeds silently", async () => {
      await using tmp = await tmpdir({ git: true })

      const ok = await withInstance(tmp.path, () =>
        Worktree.remove({ directory: path.join(tmp.path, "does-not-exist") }),
      )
      expect(ok).toBe(true)
    })

    test("throws NotGitError for non-git directories", async () => {
      await using tmp = await tmpdir()

      await expect(withInstance(tmp.path, () => Worktree.remove({ directory: "/tmp/fake" }))).rejects.toThrow(
        "WorktreeNotGitError",
      )
    })
  })
})
