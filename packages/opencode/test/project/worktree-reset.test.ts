import { $ } from "bun"
import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

const wintest = process.platform === "win32" ? test : test.skip

function withInstance(directory: string, fn: () => Promise<any>) {
  return Instance.provide({ directory, fn })
}

describe("Worktree.reset", () => {
  afterEach(() => Instance.disposeAll())

  test("restores tracked files and removes untracked files", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    const file = path.join(root, "README.md")
    await Bun.write(file, "# reset\n")
    await $`git add README.md`.cwd(root).quiet()
    await $`git commit -m "add readme"`.cwd(root).quiet()

    const info = await withInstance(root, async () => {
      const info = await Worktree.makeWorktreeInfo(`reset-${Date.now().toString(36)}`)
      await Worktree.createFromInfo(info)
      return info
    })

    const readme = path.join(info.directory, "README.md")
    const extra = path.join(info.directory, `extra-${Date.now().toString(36)}.txt`)
    const text = await fs.readFile(readme, "utf8")
    await fs.writeFile(readme, `${text.trimEnd()}\nchange\n`, "utf8")
    await fs.writeFile(extra, "extra\n", "utf8")

    const ok = await withInstance(root, () => Worktree.reset({ directory: info.directory }))
    expect(ok).toBe(true)

    expect(await fs.readFile(readme, "utf8")).toBe(text)
    expect(await fs.stat(extra).then(() => true).catch(() => false)).toBe(false)
    expect((await $`git status --porcelain=v1`.cwd(info.directory).quiet().text()).trim()).toBe("")
  })

  wintest("stops fsmonitor before resetting a worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    const file = path.join(root, "README.md")
    await Bun.write(file, "# reset\n")
    await $`git add README.md`.cwd(root).quiet()
    await $`git commit -m "add readme"`.cwd(root).quiet()

    const info = await withInstance(root, async () => {
      const info = await Worktree.makeWorktreeInfo(`reset-fsmonitor-${Date.now().toString(36)}`)
      await Worktree.createFromInfo(info)
      return info
    })

    const readme = path.join(info.directory, "README.md")
    const extra = path.join(info.directory, `extra-${Date.now().toString(36)}.txt`)
    const text = await fs.readFile(readme, "utf8")

    await $`git config core.fsmonitor true`.cwd(info.directory).quiet()
    await $`git fsmonitor--daemon stop`.cwd(info.directory).quiet().nothrow()
    await fs.writeFile(readme, `${text.trimEnd()}\nchange\n`, "utf8")
    await fs.writeFile(extra, "extra\n", "utf8")
    await $`git diff`.cwd(info.directory).quiet()

    const before = await $`git fsmonitor--daemon status`.cwd(info.directory).quiet().nothrow()
    expect(before.exitCode).toBe(0)

    const ok = await withInstance(root, () => Worktree.reset({ directory: info.directory }))
    expect(ok).toBe(true)

    expect(await fs.readFile(readme, "utf8")).toBe(text)
    expect(await fs.stat(extra).then(() => true).catch(() => false)).toBe(false)
    expect((await $`git status --porcelain=v1`.cwd(info.directory).quiet().text()).trim()).toBe("")
  })
})
