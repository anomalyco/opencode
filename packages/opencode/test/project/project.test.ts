import { describe, expect, test } from "bun:test"
import { Project } from "../../src/project/project"
import { Log } from "../../src/util/log"
import { Storage } from "../../src/storage/storage"
import { $ } from "bun"
import path from "path"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("Project.fromDirectory", () => {
  test("should handle git repository with no commits", async () => {
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()

    const project = await Project.fromDirectory(tmp.path)

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

    const project = await Project.fromDirectory(tmp.path)

    expect(project).toBeDefined()
    expect(project.id).not.toBe("global")
    expect(project.id).not.toContain("|") // main worktree uses root commit only
    expect(project.vcs).toBe("git")
    expect(project.worktree).toBe(tmp.path)

    const opencodeFile = path.join(tmp.path, ".git", "opencode")
    const fileExists = await Bun.file(opencodeFile).exists()
    expect(fileExists).toBe(true)

    // Should not create opencode-worktree file for main worktree
    const worktreeFile = path.join(tmp.path, ".git", "opencode-worktree")
    const worktreeFileExists = await Bun.file(worktreeFile).exists()
    expect(worktreeFileExists).toBe(false)
  })

  test("should use different ID format for linked worktrees", async () => {
    await using tmp = await tmpdir({ git: true })
    const worktreePath = `${tmp.path}-worktree`
    await $`git worktree add ${worktreePath} HEAD`.cwd(tmp.path).quiet()

    try {
      const mainProject = await Project.fromDirectory(tmp.path)
      const linkedProject = await Project.fromDirectory(worktreePath)

      // Main worktree uses root commit only
      expect(mainProject.id).not.toContain("|")

      // Linked worktree uses root commit + "|" + hash
      expect(linkedProject.id).toContain("|")
      expect(linkedProject.id.startsWith(mainProject.id + "|")).toBe(true)

      // Different IDs for different worktrees
      expect(linkedProject.id).not.toBe(mainProject.id)

      // Linked worktree should have opencode-worktree file
      const gitDir = await $`git rev-parse --git-dir`.cwd(worktreePath).quiet().text()
      const worktreeFile = path.join(gitDir.trim(), "opencode-worktree")
      const worktreeFileExists = await Bun.file(worktreeFile).exists()
      expect(worktreeFileExists).toBe(true)
    } finally {
      await $`git worktree remove --force ${worktreePath}`.cwd(tmp.path).quiet().nothrow()
      await $`rm -rf ${worktreePath}`.quiet()
    }
  })
})

describe("Project.discover", () => {
  test("should discover favicon.png in root", async () => {
    await using tmp = await tmpdir({ git: true })
    const project = await Project.fromDirectory(tmp.path)

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
    const project = await Project.fromDirectory(tmp.path)

    await Bun.write(path.join(tmp.path, "favicon.txt"), "not an image")

    await Project.discover(project)

    const updated = await Storage.read<Project.Info>(["project", project.id])
    expect(updated.icon).toBeUndefined()
  })
})
