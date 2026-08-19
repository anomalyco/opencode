import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "os"
import { Process } from "@/util/process"
import { Worktree } from "@/git/worktree"

async function git(cwd: string, args: string[]) {
  return Process.run(["git", ...args], { cwd })
}

async function initRepo(dir: string) {
  await git(dir, ["init", "-q", "-b", "main"])
  await git(dir, ["config", "user.email", "test@example.com"])
  await git(dir, ["config", "user.name", "Test"])
  await fs.writeFile(path.join(dir, "README.md"), "hello\n")
  await git(dir, ["add", "."])
  await git(dir, ["commit", "-q", "-m", "initial"])
}

let scratch: string
let repoRoot: string

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(tmpdir(), "opencode-worktree-test-"))
  repoRoot = path.join(scratch, "repo")
  await fs.mkdir(repoRoot)
  await initRepo(repoRoot)
})

afterEach(async () => {
  await fs.rm(scratch, { recursive: true, force: true })
})

describe("git.worktree", () => {
  test("ensure creates a worktree and branch at the sibling convention", async () => {
    const info = await Worktree.ensure(repoRoot, "my-change")
    expect(info.path).toBe(path.join(scratch, "opencode-worktrees", "my-change"))
    expect(info.branch).toBe("loop/my-change")
    const stat = await fs.stat(info.path)
    expect(stat.isDirectory()).toBe(true)
    const branchList = await git(info.path, ["branch", "--show-current"])
    expect(branchList.stdout.toString().trim()).toBe("loop/my-change")
  })

  test("ensure is idempotent: a second call reuses the same worktree", async () => {
    const first = await Worktree.ensure(repoRoot, "my-change")
    await fs.writeFile(path.join(first.path, "marker.txt"), "still here\n")
    const second = await Worktree.ensure(repoRoot, "my-change")
    expect(second.path).toBe(first.path)
    await expect(fs.stat(path.join(second.path, "marker.txt"))).resolves.toBeDefined()
  })

  test("ensure rejects a path that exists but is not a git worktree", async () => {
    const dir = Worktree.worktreePath(repoRoot, "not-a-worktree")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "stray.txt"), "not git\n")
    await expect(Worktree.ensure(repoRoot, "not-a-worktree")).rejects.toThrow(Worktree.WorktreeError)
  })

  test("merge brings the worktree's commit into the main checkout, never pushes", async () => {
    const info = await Worktree.ensure(repoRoot, "my-change")
    await fs.writeFile(path.join(info.path, "feature.txt"), "new feature\n")
    await git(info.path, ["add", "."])
    await git(info.path, ["commit", "-q", "-m", "add feature"])

    await Worktree.merge(repoRoot, "my-change")

    await expect(fs.stat(path.join(repoRoot, "feature.txt"))).resolves.toBeDefined()
    const log = await git(repoRoot, ["log", "--oneline", "-1"])
    expect(log.stdout.toString()).toContain("Merge branch")
    // No remote configured in the scratch repo — a push attempt would fail
    // loudly, so its absence here is directly verified by merge() succeeding
    // without ever invoking git push.
    const remotes = await git(repoRoot, ["remote"])
    expect(remotes.stdout.toString().trim()).toBe("")
  })

  test("cleanup removes the worktree only, leaving the branch and main checkout intact", async () => {
    const info = await Worktree.ensure(repoRoot, "my-change")
    await Worktree.cleanup(repoRoot, "my-change")
    await expect(fs.stat(info.path)).rejects.toThrow()
    const branches = await git(repoRoot, ["branch", "--list", "loop/my-change"])
    expect(branches.stdout.toString()).toContain("loop/my-change")
  })

  test("cleanup on an already-removed slug does not throw", async () => {
    await Worktree.ensure(repoRoot, "my-change")
    await Worktree.cleanup(repoRoot, "my-change")
    await expect(Worktree.cleanup(repoRoot, "my-change")).resolves.toBeUndefined()
  })

  test("two slugs get two independent worktrees", async () => {
    const a = await Worktree.ensure(repoRoot, "change-a")
    const b = await Worktree.ensure(repoRoot, "change-b")
    expect(a.path).not.toBe(b.path)
    await fs.writeFile(path.join(a.path, "a.txt"), "a\n")
    await git(a.path, ["add", "."])
    await git(a.path, ["commit", "-q", "-m", "a"])
    // change-b's worktree must not see change-a's commit as its own branch state
    const bBranch = await git(b.path, ["branch", "--show-current"])
    expect(bBranch.stdout.toString().trim()).toBe("loop/change-b")
    await expect(fs.stat(path.join(b.path, "a.txt"))).rejects.toThrow()
  })
})
