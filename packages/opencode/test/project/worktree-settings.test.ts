import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { eq } from "drizzle-orm"

describe("Worktree.create (settings)", () => {
  test("creates symlinks and copies from project root", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path

    // Setup: Create files in root to be symlinked/copied
    await Bun.write(path.join(root, ".env"), "SECRET=true")
    await fs.mkdir(path.join(root, "config"), { recursive: true })
    await Bun.write(path.join(root, "config", "shared.json"), '{"shared":true}')
    await fs.mkdir(path.join(root, "data"), { recursive: true })
    await Bun.write(path.join(root, "data", "seed.txt"), "seed data")

    // Determine default branch
    const defaultBranch = (await $`git branch --show-current`.cwd(root).text()).trim()

    // Setup: Initialize project in DB to set worktree settings
    await Instance.provide({
      directory: root,
      fn: async () => {
        // Ensure project exists in DB
        const project = Instance.project

        // Update project with worktree settings
        await Project.update({
          projectID: project.id,
          worktreeSettings: {
            baseBranch: defaultBranch,
            symlinks: [".env", "config/shared.json"],
            copies: ["data"],
          },
        })
      },
    })

    // Execute: Create worktree
    const result = await Instance.provide({
      directory: root,
      fn: async () => {
        return Worktree.create({
          name: "test-workspace",
        })
      },
    })

    const worktreeDir = result.directory

    // Verify: Symlinks
    const envLink = path.join(worktreeDir, ".env")
    const configLink = path.join(worktreeDir, "config", "shared.json")

    expect(await fs.lstat(envLink).then((s) => s.isSymbolicLink())).toBe(true)
    expect(await fs.readlink(envLink)).toBe(path.join(root, ".env"))

    expect(await fs.lstat(configLink).then((s) => s.isSymbolicLink())).toBe(true)
    expect(await fs.readlink(configLink)).toBe(path.join(root, "config", "shared.json"))

    // Verify: Copies
    const dataCopy = path.join(worktreeDir, "data", "seed.txt")
    expect(await Bun.file(dataCopy).exists()).toBe(true)
    expect(await fs.lstat(path.join(worktreeDir, "data")).then((s) => s.isSymbolicLink())).toBe(false)
    expect(await Bun.file(dataCopy).text()).toBe("seed data")
  })

  test("uses specified base branch from settings", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path

    // Create a 'dev' branch
    const defaultBranch = (await $`git branch --show-current`.cwd(root).text()).trim()
    await $`git checkout -b dev`.cwd(root).quiet()
    await $`touch dev-file`.cwd(root).quiet()
    await $`git add . && git commit -m "dev commit"`.cwd(root).quiet()

    // Switch back to master/main
    await $`git checkout ${defaultBranch}`.cwd(root).quiet()

    // Setup project with baseBranch = 'dev'
    await Instance.provide({
      directory: root,
      fn: async () => {
        await Project.update({
          projectID: Instance.project.id,
          worktreeSettings: {
            baseBranch: "dev",
          },
        })
      },
    })

    // Create worktree
    const result = await Instance.provide({
      directory: root,
      fn: async () => Worktree.create({ name: "feature-a" }),
    })

    // Verify it branched from dev
    // Check if dev-file exists in the new worktree
    // Note: worktree create --no-checkout doesn't populate files immediately until reset --hard
    // But Worktree.create runs reset --hard async. We might need to wait or check git history.

    // Better check: check the parent commit of the new branch
    const headSHA = (await $`git rev-parse HEAD`.cwd(result.directory).text()).trim()
    const devSHA = (await $`git rev-parse dev`.cwd(root).text()).trim()

    expect(headSHA).toBe(devSHA)
  })
})
