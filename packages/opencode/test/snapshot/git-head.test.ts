import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { Snapshot } from "../../src/snapshot"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

async function bootstrap() {
  return tmpdir({
    git: true,
    init: async (dir) => {
      const unique = Math.random().toString(36).slice(2)
      await Bun.write(`${dir}/a.txt`, `A${unique}`)
      await $`git add .`.cwd(dir).quiet()
      await $`git commit --no-gpg-sign -m "initial commit"`.cwd(dir).quiet()
      return { unique }
    },
  })
}

describe("Snapshot.getProjectHead", () => {
  test("returns current HEAD commit hash", async () => {
    await using tmp = await bootstrap()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const head = await Snapshot.getProjectHead()
        expect(head).toBeTruthy()
        expect(head!.length).toBe(40) // SHA-1 hash length
      },
    })
  })

  test("returns undefined for non-git directory", async () => {
    await using tmp = await tmpdir({ git: false })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const head = await Snapshot.getProjectHead()
        expect(head).toBeUndefined()
      },
    })
  })

  test("HEAD changes after commit", async () => {
    await using tmp = await bootstrap()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const headBefore = await Snapshot.getProjectHead()

        await Bun.write(`${tmp.path}/new.txt`, "new content")
        await $`git add .`.cwd(tmp.path).quiet()
        await $`git commit --no-gpg-sign -m "add new file"`.cwd(tmp.path).quiet()

        const headAfter = await Snapshot.getProjectHead()

        expect(headBefore).toBeTruthy()
        expect(headAfter).toBeTruthy()
        expect(headBefore).not.toBe(headAfter)
      },
    })
  })
})

describe("Snapshot.getProjectChangedFiles", () => {
  test("returns empty array for same commits", async () => {
    await using tmp = await bootstrap()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const head = await Snapshot.getProjectHead()
        const files = await Snapshot.getProjectChangedFiles(head!, head!)
        expect(files).toEqual([])
      },
    })
  })

  test("returns changed files between commits", async () => {
    await using tmp = await bootstrap()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const headBefore = await Snapshot.getProjectHead()

        await Bun.write(`${tmp.path}/new.txt`, "new content")
        await Bun.write(`${tmp.path}/another.txt`, "another file")
        await $`git add .`.cwd(tmp.path).quiet()
        await $`git commit --no-gpg-sign -m "add new files"`.cwd(tmp.path).quiet()

        const headAfter = await Snapshot.getProjectHead()
        const files = await Snapshot.getProjectChangedFiles(headBefore!, headAfter!)

        expect(files).toContain("new.txt")
        expect(files).toContain("another.txt")
        expect(files.length).toBe(2)
      },
    })
  })

  test("detects modified files", async () => {
    await using tmp = await bootstrap()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const headBefore = await Snapshot.getProjectHead()

        await Bun.write(`${tmp.path}/a.txt`, "modified content")
        await $`git add .`.cwd(tmp.path).quiet()
        await $`git commit --no-gpg-sign -m "modify a.txt"`.cwd(tmp.path).quiet()

        const headAfter = await Snapshot.getProjectHead()
        const files = await Snapshot.getProjectChangedFiles(headBefore!, headAfter!)

        expect(files).toContain("a.txt")
        expect(files.length).toBe(1)
      },
    })
  })

  test("detects deleted files", async () => {
    await using tmp = await bootstrap()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const headBefore = await Snapshot.getProjectHead()

        await $`git rm a.txt`.cwd(tmp.path).quiet()
        await $`git commit --no-gpg-sign -m "delete a.txt"`.cwd(tmp.path).quiet()

        const headAfter = await Snapshot.getProjectHead()
        const files = await Snapshot.getProjectChangedFiles(headBefore!, headAfter!)

        expect(files).toContain("a.txt")
        expect(files.length).toBe(1)
      },
    })
  })

  test("handles multiple commits between HEAD changes", async () => {
    await using tmp = await bootstrap()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const headBefore = await Snapshot.getProjectHead()

        // First commit
        await Bun.write(`${tmp.path}/file1.txt`, "content1")
        await $`git add .`.cwd(tmp.path).quiet()
        await $`git commit --no-gpg-sign -m "add file1"`.cwd(tmp.path).quiet()

        // Second commit
        await Bun.write(`${tmp.path}/file2.txt`, "content2")
        await $`git add .`.cwd(tmp.path).quiet()
        await $`git commit --no-gpg-sign -m "add file2"`.cwd(tmp.path).quiet()

        // Third commit
        await Bun.write(`${tmp.path}/file3.txt`, "content3")
        await $`git add .`.cwd(tmp.path).quiet()
        await $`git commit --no-gpg-sign -m "add file3"`.cwd(tmp.path).quiet()

        const headAfter = await Snapshot.getProjectHead()
        const files = await Snapshot.getProjectChangedFiles(headBefore!, headAfter!)

        expect(files).toContain("file1.txt")
        expect(files).toContain("file2.txt")
        expect(files).toContain("file3.txt")
        expect(files.length).toBe(3)
      },
    })
  })
})

describe("git pull simulation", () => {
  test("detects files changed by simulated git pull", async () => {
    await using tmp = await bootstrap()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create a "remote" branch with changes
        await $`git checkout -b feature`.cwd(tmp.path).quiet()
        await Bun.write(`${tmp.path}/pulled-file1.txt`, "pulled content 1")
        await Bun.write(`${tmp.path}/pulled-file2.txt`, "pulled content 2")
        await Bun.write(`${tmp.path}/a.txt`, "modified by pull")
        await $`git add .`.cwd(tmp.path).quiet()
        await $`git commit --no-gpg-sign -m "feature changes"`.cwd(tmp.path).quiet()

        // Go back to main and record HEAD
        await $`git checkout -`.cwd(tmp.path).quiet()
        const headBefore = await Snapshot.getProjectHead()

        // Simulate merge (like git pull would do)
        await $`git merge feature --no-edit`.cwd(tmp.path).quiet()
        const headAfter = await Snapshot.getProjectHead()

        // Get files changed by the "pull"
        const files = await Snapshot.getProjectChangedFiles(headBefore!, headAfter!)

        expect(files).toContain("pulled-file1.txt")
        expect(files).toContain("pulled-file2.txt")
        expect(files).toContain("a.txt")
        expect(files.length).toBe(3)
      },
    })
  })
})
