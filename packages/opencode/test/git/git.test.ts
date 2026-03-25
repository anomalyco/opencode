import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { ManagedRuntime } from "effect"
import { Git } from "../../src/git"
import { tmpdir } from "../fixture/fixture"

const weird = process.platform === "win32" ? "space file.txt" : "tab\tfile.txt"

async function withGit<T>(body: (rt: ManagedRuntime.ManagedRuntime<Git.Service, never>) => Promise<T>) {
  const rt = ManagedRuntime.make(Git.defaultLayer)
  try {
    return await body(rt)
  } finally {
    await rt.dispose()
  }
}

describe("Git", () => {
  test("branch() returns current branch name", async () => {
    await using tmp = await tmpdir({ git: true })

    await withGit(async (rt) => {
      const branch = await rt.runPromise(Git.Service.use((git) => git.branch(tmp.path)))
      expect(branch).toBeDefined()
      expect(typeof branch).toBe("string")
    })
  })

  test("branch() returns undefined for non-git directories", async () => {
    await using tmp = await tmpdir()

    await withGit(async (rt) => {
      const branch = await rt.runPromise(Git.Service.use((git) => git.branch(tmp.path)))
      expect(branch).toBeUndefined()
    })
  })

  test("branch() returns undefined for detached HEAD", async () => {
    await using tmp = await tmpdir({ git: true })
    const hash = (await $`git rev-parse HEAD`.cwd(tmp.path).quiet().text()).trim()
    await $`git checkout --detach ${hash}`.cwd(tmp.path).quiet()

    await withGit(async (rt) => {
      const branch = await rt.runPromise(Git.Service.use((git) => git.branch(tmp.path)))
      expect(branch).toBeUndefined()
    })
  })

  test("defaultBranch() uses init.defaultBranch when available", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git branch -M trunk`.cwd(tmp.path).quiet()
    await $`git config init.defaultBranch trunk`.cwd(tmp.path).quiet()

    await withGit(async (rt) => {
      const branch = await rt.runPromise(Git.Service.use((git) => git.defaultBranch(tmp.path)))
      expect(branch?.name).toBe("trunk")
      expect(branch?.ref).toBe("trunk")
    })
  })

  test("status() handles special filenames", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, weird), "hello\n", "utf-8")

    await withGit(async (rt) => {
      const status = await rt.runPromise(Git.Service.use((git) => git.status(tmp.path)))
      expect(status).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: weird,
            status: "added",
          }),
        ]),
      )
    })
  })

  test("diff(), stats(), and mergeBase() parse tracked changes", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git branch -M main`.cwd(tmp.path).quiet()
    await fs.writeFile(path.join(tmp.path, weird), "before\n", "utf-8")
    await $`git add .`.cwd(tmp.path).quiet()
    await $`git commit --no-gpg-sign -m "add file"`.cwd(tmp.path).quiet()
    await $`git checkout -b feature/test`.cwd(tmp.path).quiet()
    await fs.writeFile(path.join(tmp.path, weird), "after\n", "utf-8")

    await withGit(async (rt) => {
      const [base, diff, stats] = await Promise.all([
        rt.runPromise(Git.Service.use((git) => git.mergeBase(tmp.path, "main"))),
        rt.runPromise(Git.Service.use((git) => git.diff(tmp.path, "HEAD"))),
        rt.runPromise(Git.Service.use((git) => git.stats(tmp.path, "HEAD"))),
      ])

      expect(base).toBeTruthy()
      expect(diff).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: weird,
            status: "modified",
          }),
        ]),
      )
      expect(stats).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: weird,
            additions: 1,
            deletions: 1,
          }),
        ]),
      )
    })
  })

  test("show() returns empty text for binary blobs", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "bin.dat"), new Uint8Array([0, 1, 2, 3]))
    await $`git add .`.cwd(tmp.path).quiet()
    await $`git commit --no-gpg-sign -m "add binary"`.cwd(tmp.path).quiet()

    await withGit(async (rt) => {
      const text = await rt.runPromise(Git.Service.use((git) => git.show(tmp.path, "HEAD", "bin.dat")))
      expect(text).toBe("")
    })
  })
})
