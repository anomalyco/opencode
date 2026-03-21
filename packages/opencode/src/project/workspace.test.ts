import { afterAll, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { $ } from "bun"
import { validateWorkspace } from "./workspace"

const created: string[] = []

async function temp(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  created.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(created.map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

test("validates the current repo workspace", async () => {
  const result = await validateWorkspace(path.resolve(import.meta.dir, "../../../.."))
  expect(result.valid).toBe(true)
  if (!result.valid) return
  expect(result.directory.endsWith("numeral-opencode")).toBe(true)
  expect(result.common.endsWith("numeral-opencode")).toBe(true)
})

test("rejects a directory that is not a git workspace", async () => {
  const dir = await temp("workspace-invalid-")
  const result = await validateWorkspace(dir)
  expect(result.valid).toBe(false)
  if (result.valid) return
  expect(result.reason.length > 0).toBe(true)
})

test("validates a git worktree", async () => {
  const repo = await temp("workspace-repo-")
  await $`git init`.cwd(repo).quiet()
  await fs.writeFile(path.join(repo, "README.md"), "# test\n")
  await $`git add README.md`.cwd(repo).quiet()
  await $`git -c user.email=test@example.com -c user.name=test commit -m init`.cwd(repo).quiet()

  const worktree = path.join(repo, "sandbox")
  await $`git worktree add ${worktree} -b sandbox`.cwd(repo).quiet()

  const root = await validateWorkspace(repo)
  const sandbox = await validateWorkspace(worktree)

  expect(root.valid).toBe(true)
  expect(sandbox.valid).toBe(true)
  if (!root.valid || !sandbox.valid) return
  expect(sandbox.common).toBe(root.common)
})
