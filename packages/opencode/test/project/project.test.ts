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

describe("Project.fromDirectory with .git file resolution", () => {
  test("should follow .git file with gitdir: link", async () => {
    await using tmp = await tmpdir({ git: true })

    // Create a fake worktree by manually creating a .git file with gitdir: content
    const fakeWorktreePath = path.join(tmp.path, "..", "fake-worktree")
    await $`mkdir -p ${fakeWorktreePath}`.quiet()

    // Create the .git file that points to the real git directory
    const gitFilePath = path.join(fakeWorktreePath, ".git")
    const gitDirPath = path.join(tmp.path, ".git")
    await Bun.write(gitFilePath, `gitdir: ${gitDirPath}\n`)

    const { project, sandbox } = await Project.fromDirectory(fakeWorktreePath)

    expect(project).toBeDefined()
    expect(project.id).not.toBe("global")
    expect(project.vcs).toBe("git")
    expect(project.worktree).toBe(tmp.path)
    // sandbox is the directory where .git file was found
    expect(sandbox).toBe(fakeWorktreePath)

    await $`rm -rf ${fakeWorktreePath}`.quiet()
  })

  test("should handle .git file with relative gitdir path", async () => {
    await using tmp = await tmpdir({ git: true })

    // Create a fake worktree structure with relative path
    const fakeWorktreePath = path.join(tmp.path, "..", "relative-worktree")
    await $`mkdir -p ${fakeWorktreePath}`.quiet()

    // Use a relative path in the gitdir: line
    const gitFilePath = path.join(fakeWorktreePath, ".git")
    await Bun.write(gitFilePath, `gitdir: ../opencode-test-${path.basename(tmp.path).split('-').pop()}/.git\n`)

    const { project } = await Project.fromDirectory(fakeWorktreePath)

    expect(project).toBeDefined()
    expect(project.worktree).toBe(tmp.path)

    await $`rm -rf ${fakeWorktreePath}`.quiet()
  })

  test("should handle .git file pointing to non-existent directory", async () => {
    await using tmp = await tmpdir()

    const gitFilePath = path.join(tmp.path, ".git")
    await Bun.write(gitFilePath, `gitdir: /nonexistent/path/.git\n`)

    const { project } = await Project.fromDirectory(tmp.path)

    // Should fall back to global since the linked git dir doesn't exist
    expect(project.id).toBe("global")
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
