import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { ManagedRuntime } from "effect"
import { GitEffect } from "../../src/git/effect"
import { tmpdir } from "../fixture/fixture"

const weird = process.platform === "win32" ? "space file.txt" : "tab\tfile.txt"

async function withGit<T>(fn: (rt: ManagedRuntime.ManagedRuntime<GitEffect.Service, never>) => Promise<T>) {
  const rt = ManagedRuntime.make(GitEffect.defaultLayer)
  try {
    return await fn(rt)
  } finally {
    await rt.dispose()
  }
}

describe("Git", () => {
  test("branch() returns current branch name", async () => {
    await using tmp = await tmpdir({ git: true })

    await withGit(async (rt) => {
      const branch = await rt.runPromise(GitEffect.Service.use((git) => git.branch(tmp.path)))
      expect(branch).toBeDefined()
      expect(typeof branch).toBe("string")
    })
  })

  test("branch() returns undefined for non-git directories", async () => {
    await using tmp = await tmpdir()

    await withGit(async (rt) => {
      const branch = await rt.runPromise(GitEffect.Service.use((git) => git.branch(tmp.path)))
      expect(branch).toBeUndefined()
    })
  })

  test("defaultBranch() uses init.defaultBranch when available", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git branch -M trunk`.cwd(tmp.path).quiet()
    await $`git config init.defaultBranch trunk`.cwd(tmp.path).quiet()

    await withGit(async (rt) => {
      const branch = await rt.runPromise(GitEffect.Service.use((git) => git.defaultBranch(tmp.path)))
      expect(branch?.name).toBe("trunk")
      expect(branch?.ref).toBe("trunk")
    })
  })

  test("status() handles special filenames", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = weird
    await fs.writeFile(path.join(tmp.path, file), "hello\n", "utf-8")

    await withGit(async (rt) => {
      const status = await rt.runPromise(GitEffect.Service.use((git) => git.status(tmp.path)))
      expect(status).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file,
            status: "added",
          }),
        ]),
      )
    })
  })

  test("diff(), stats(), and mergeBase() parse tracked changes", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git branch -M main`.cwd(tmp.path).quiet()
    const file = weird
    await fs.writeFile(path.join(tmp.path, file), "before\n", "utf-8")
    await $`git add .`.cwd(tmp.path).quiet()
    await $`git commit --no-gpg-sign -m "add file"`.cwd(tmp.path).quiet()
    await $`git checkout -b feature/test`.cwd(tmp.path).quiet()
    await fs.writeFile(path.join(tmp.path, file), "after\n", "utf-8")

    await withGit(async (rt) => {
      const [base, diff, stats] = await Promise.all([
        rt.runPromise(GitEffect.Service.use((git) => git.mergeBase(tmp.path, "main"))),
        rt.runPromise(GitEffect.Service.use((git) => git.diff(tmp.path, "HEAD"))),
        rt.runPromise(GitEffect.Service.use((git) => git.stats(tmp.path, "HEAD"))),
      ])

      expect(base).toBeTruthy()
      expect(diff).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file,
            status: "modified",
          }),
        ]),
      )
      expect(stats).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file,
            additions: 1,
            deletions: 1,
          }),
        ]),
      )
    })
  })
})
