import { describe, expect, test } from "bun:test"
import { Project } from "../../src/project/project"
import { Log } from "../../src/util/log"
import { Storage } from "../../src/storage/storage"
import { $ } from "bun"
import path from "path"
import * as fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("Project.fromDirectory", () => {
  test("should handle git repository with no commits", async () => {
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()

    const { project } = await Project.fromDirectory(tmp.path)

    expect(project).toBeDefined()
    expect(project.id).toBe("global")
    expect(project.vcs).toBe("git")
    expect(project.worktree).toBe(tmp.path)

    const opencodeFile = path.join(tmp.path, ".git", "opencode")
    const fileExists = await Bun.file(opencodeFile).exists()
    expect(fileExists).toBe(false)
  })

  test("should handle git repository with commits", async () => {
    await using tmp = await tmpdir({ git: true })

    const { project } = await Project.fromDirectory(tmp.path)

    expect(project).toBeDefined()
    expect(project.id).not.toBe("global")
    expect(project.vcs).toBe("git")
    expect(project.worktree).toBe(tmp.path)

    const opencodeFile = path.join(tmp.path, ".git", "opencode")
    const fileExists = await Bun.file(opencodeFile).exists()
    expect(fileExists).toBe(true)
  })
})

describe("Project.fromDirectory with worktrees", () => {
  test("should set worktree to root when called from root", async () => {
    await using tmp = await tmpdir({ git: true })

    const { project, sandbox } = await Project.fromDirectory(tmp.path)

    expect(project.worktree).toBe(tmp.path)
    expect(sandbox).toBe(tmp.path)
    expect(project.sandboxes).not.toContain(tmp.path)
  })

  test("should set worktree to root when called from a worktree", async () => {
    await using tmp = await tmpdir({ git: true })

    const worktreePath = path.join(tmp.path, "..", "worktree-test")
    await $`git worktree add ${worktreePath} -b test-branch`.cwd(tmp.path).quiet()

    const { project, sandbox } = await Project.fromDirectory(worktreePath)

    expect(project.worktree).toBe(tmp.path)
    expect(sandbox).toBe(worktreePath)
    expect(project.sandboxes).toContain(worktreePath)
    expect(project.sandboxes).not.toContain(tmp.path)

    await $`git worktree remove ${worktreePath}`.cwd(tmp.path).quiet()
  })

  test("should accumulate multiple worktrees in sandboxes", async () => {
    await using tmp = await tmpdir({ git: true })

    const worktree1 = path.join(tmp.path, "..", "worktree-1")
    const worktree2 = path.join(tmp.path, "..", "worktree-2")
    await $`git worktree add ${worktree1} -b branch-1`.cwd(tmp.path).quiet()
    await $`git worktree add ${worktree2} -b branch-2`.cwd(tmp.path).quiet()

    await Project.fromDirectory(worktree1)
    const { project } = await Project.fromDirectory(worktree2)

    expect(project.worktree).toBe(tmp.path)
    expect(project.sandboxes).toContain(worktree1)
    expect(project.sandboxes).toContain(worktree2)
    expect(project.sandboxes).not.toContain(tmp.path)

    await $`git worktree remove ${worktree1}`.cwd(tmp.path).quiet()
    await $`git worktree remove ${worktree2}`.cwd(tmp.path).quiet()
  })
})

describe("Project.scan", () => {
  test("should discover git repos in a directory", async () => {
    await using tmp = await tmpdir()

    // Create two git repos inside the base directory
    const repo1 = path.join(tmp.path, "repo1")
    const repo2 = path.join(tmp.path, "repo2")
    await fs.mkdir(repo1, { recursive: true })
    await fs.mkdir(repo2, { recursive: true })

    await $`git init`.cwd(repo1).quiet()
    await $`git commit --allow-empty -m "root commit 1"`.cwd(repo1).quiet()
    await $`git init`.cwd(repo2).quiet()
    await $`git commit --allow-empty -m "root commit 2"`.cwd(repo2).quiet()

    const projects = await Project.scan([tmp.path])

    expect(projects.length).toBe(2)
    const worktrees = projects.map((p) => p.worktree).sort()
    expect(worktrees).toContain(repo1)
    expect(worktrees).toContain(repo2)
  })

  test("should skip node_modules directories", async () => {
    await using tmp = await tmpdir()

    // Create a normal repo and one inside node_modules
    const repo = path.join(tmp.path, "real-repo")
    const nmRepo = path.join(tmp.path, "node_modules", "some-pkg")
    await fs.mkdir(repo, { recursive: true })
    await fs.mkdir(nmRepo, { recursive: true })

    await $`git init`.cwd(repo).quiet()
    await $`git commit --allow-empty -m "root commit"`.cwd(repo).quiet()
    await $`git init`.cwd(nmRepo).quiet()
    await $`git commit --allow-empty -m "root commit"`.cwd(nmRepo).quiet()

    const projects = await Project.scan([tmp.path])

    expect(projects.length).toBe(1)
    expect(projects[0].worktree).toBe(repo)
  })

  test("should skip repos without commits", async () => {
    await using tmp = await tmpdir()

    const committed = path.join(tmp.path, "committed")
    const empty = path.join(tmp.path, "empty")
    await fs.mkdir(committed, { recursive: true })
    await fs.mkdir(empty, { recursive: true })

    await $`git init`.cwd(committed).quiet()
    await $`git commit --allow-empty -m "root commit"`.cwd(committed).quiet()
    await $`git init`.cwd(empty).quiet()

    const projects = await Project.scan([tmp.path])

    // Only the committed repo should appear (empty returns "global" which is filtered)
    expect(projects.length).toBe(1)
    expect(projects[0].worktree).toBe(committed)
  })

  test("should return empty for directory with no git repos", async () => {
    await using tmp = await tmpdir()

    await fs.mkdir(path.join(tmp.path, "just-a-folder"), { recursive: true })
    await Bun.write(path.join(tmp.path, "file.txt"), "hello")

    const projects = await Project.scan([tmp.path])

    expect(projects.length).toBe(0)
  })

  test("should find nested git repos", async () => {
    await using tmp = await tmpdir()

    // Create a nested structure: parent/child/grandchild
    const parent = path.join(tmp.path, "org", "project")
    await fs.mkdir(parent, { recursive: true })

    await $`git init`.cwd(parent).quiet()
    await $`git commit --allow-empty -m "root commit"`.cwd(parent).quiet()

    const projects = await Project.scan([tmp.path])

    expect(projects.length).toBe(1)
    expect(projects[0].worktree).toBe(parent)
  })
})

describe("Project.discover", () => {
  test("should discover favicon.png in root", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await Bun.write(path.join(tmp.path, "favicon.png"), pngData)

    await Project.discover(project)

    const updated = await Storage.read<Project.Info>(["project", project.id])
    expect(updated.icon).toBeDefined()
    expect(updated.icon?.url).toStartWith("data:")
    expect(updated.icon?.url).toContain("base64")
    expect(updated.icon?.color).toBeUndefined()
  })

  test("should not discover non-image files", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    await Bun.write(path.join(tmp.path, "favicon.txt"), "not an image")

    await Project.discover(project)

    const updated = await Storage.read<Project.Info>(["project", project.id])
    expect(updated.icon).toBeUndefined()
  })
})
