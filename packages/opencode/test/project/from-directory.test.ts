import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Filesystem } from "../../src/util/filesystem"
import { loadProject, withMode } from "./setup"

describe("Project.fromDirectory", () => {
  test("should handle git repository with no commits", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()

    const { project } = await p.fromDirectory(tmp.path)

    expect(project).toBeDefined()
    expect(project.id).toBe("global")
    expect(project.vcs).toBe("git")
    expect(project.worktree).toBe(tmp.path)

    const file = path.join(tmp.path, ".git", "opencode")
    expect(await Filesystem.exists(file)).toBe(false)
  })

  test("should handle git repository with commits", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const { project } = await p.fromDirectory(tmp.path)

    expect(project).toBeDefined()
    expect(project.id).not.toBe("global")
    expect(project.vcs).toBe("git")
    expect(project.worktree).toBe(tmp.path)

    const file = path.join(tmp.path, ".git", "opencode")
    expect(await Filesystem.exists(file)).toBe(true)
  })

  test("keeps git vcs when HEAD is missing", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()

    await withMode("head-fail", async () => {
      const { project } = await p.fromDirectory(tmp.path)
      expect(project.vcs).toBe("git")
      expect(project.id).toBe("global")
      expect(project.worktree).toBe(tmp.path)
    })
  })

  test("keeps git vcs when show-toplevel exits non-zero with empty output", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    await withMode("top-fail", async () => {
      const { project, sandbox } = await p.fromDirectory(tmp.path)
      expect(project.vcs).toBe("git")
      expect(project.worktree).toBe(tmp.path)
      expect(sandbox).toBe(tmp.path)
    })
  })

  test("keeps git vcs when git-common-dir exits non-zero with empty output", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    await withMode("common-dir-fail", async () => {
      const { project, sandbox } = await p.fromDirectory(tmp.path)
      expect(project.vcs).toBe("git")
      expect(project.worktree).toBe(tmp.path)
      expect(sandbox).toBe(tmp.path)
    })
  })
})

describe("Project.fromDirectory with worktrees", () => {
  test("should set worktree to root when called from root", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const { project, sandbox } = await p.fromDirectory(tmp.path)

    expect(project.worktree).toBe(tmp.path)
    expect(sandbox).toBe(tmp.path)
    expect(project.sandboxes).not.toContain(tmp.path)
  })

  test("should set worktree to root when called from a worktree", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const worktreePath = path.join(tmp.path, "..", path.basename(tmp.path) + "-worktree")
    try {
      await $`git worktree add ${worktreePath} -b test-branch-${Date.now()}`.cwd(tmp.path).quiet()

      const { project, sandbox } = await p.fromDirectory(worktreePath)

      expect(project.worktree).toBe(tmp.path)
      expect(sandbox).toBe(worktreePath)
      expect(project.sandboxes).toContain(worktreePath)
      expect(project.sandboxes).not.toContain(tmp.path)
    } finally {
      await $`git worktree remove ${worktreePath}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
    }
  })

  test("should accumulate multiple worktrees in sandboxes", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const worktree1 = path.join(tmp.path, "..", path.basename(tmp.path) + "-wt1")
    const worktree2 = path.join(tmp.path, "..", path.basename(tmp.path) + "-wt2")
    try {
      await $`git worktree add ${worktree1} -b branch-${Date.now()}`.cwd(tmp.path).quiet()
      await $`git worktree add ${worktree2} -b branch-${Date.now() + 1}`.cwd(tmp.path).quiet()

      await p.fromDirectory(worktree1)
      const { project } = await p.fromDirectory(worktree2)

      expect(project.worktree).toBe(tmp.path)
      expect(project.sandboxes).toContain(worktree1)
      expect(project.sandboxes).toContain(worktree2)
      expect(project.sandboxes).not.toContain(tmp.path)
    } finally {
      await $`git worktree remove ${worktree1}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
      await $`git worktree remove ${worktree2}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
    }
  })

  test("returns a coherent project when called from root or any worktree", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const worktreePath = path.join(tmp.path, "..", path.basename(tmp.path) + "-worktree")
    try {
      await $`git worktree add ${worktreePath} -b test-branch-${Date.now()}`.cwd(tmp.path).quiet()

      const root = await p.fromDirectory(tmp.path)
      const wt = await p.fromDirectory(worktreePath)

      expect(root.project.id).not.toBe("global")
      expect(wt.project.id).toBe(root.project.id)

      expect(root.project.worktree).toBe(tmp.path)
      expect(wt.project.worktree).toBe(tmp.path)

      expect(root.sandbox).toBe(tmp.path)
      expect(wt.sandbox).toBe(worktreePath)

      expect(wt.project.sandboxes).toContain(worktreePath)
      expect(wt.project.sandboxes).not.toContain(tmp.path)
    } finally {
      await $`git worktree remove ${worktreePath}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
    }
  })

  test("reuses canonical DB project id when cache is different", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const worktreePath = path.join(tmp.path, "..", path.basename(tmp.path) + "-worktree")
    try {
      await $`git worktree add ${worktreePath} -b test-branch-${Date.now()}`.cwd(tmp.path).quiet()

      const initial = await p.fromDirectory(worktreePath)
      const canonicalId = initial.project.id
      expect(canonicalId).not.toBe("global")

      const common = await $`git rev-parse --git-common-dir`
        .cwd(tmp.path)
        .quiet()
        .then((r) => r.text())
        .then((s) => s.trim())
      const commonDir = path.isAbsolute(common) ? common : path.resolve(tmp.path, common)
      const cacheFile = path.join(commonDir, "opencode")

      await Bun.write(cacheFile, "bogus-project-id")

      const again = await p.fromDirectory(worktreePath)
      expect(again.project.id).toBe(canonicalId)
      expect(again.project.sandboxes).toContain(worktreePath)
      expect(await Bun.file(cacheFile).text()).toBe(canonicalId)
    } finally {
      await $`git worktree remove ${worktreePath}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
    }
  })
})

describe("Project.fromDirectory across clones", () => {
  test("separate clones of the same repo do not share project identity", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const clonePath = path.join(tmp.path, "..", path.basename(tmp.path) + "-clone")
    try {
      await $`git clone ${tmp.path} ${clonePath}`.quiet()

      const a = await p.fromDirectory(tmp.path)
      const b = await p.fromDirectory(clonePath)

      expect(a.project.id).not.toBe("global")
      expect(b.project.id).not.toBe("global")
      expect(a.project.id).not.toBe(b.project.id)
      expect(a.project.worktree).toBe(tmp.path)
      expect(b.project.worktree).toBe(clonePath)
    } finally {
      await fs.rm(clonePath, { recursive: true, force: true })
    }
  })

  test("upgrades legacy root-commit cache without colliding across clones", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const clonePath = path.join(tmp.path, "..", path.basename(tmp.path) + "-clone")
    try {
      await $`git clone ${tmp.path} ${clonePath}`.quiet()

      const root = await $`git rev-list --max-parents=0 HEAD`
        .cwd(tmp.path)
        .quiet()
        .then((r) => r.text())
        .then((s) => s.trim())

      await Bun.write(path.join(tmp.path, ".git", "opencode"), root)
      await Bun.write(path.join(clonePath, ".git", "opencode"), root)

      const a = await p.fromDirectory(tmp.path)
      const b = await p.fromDirectory(clonePath)

      expect(a.project.id).not.toBe(root)
      expect(b.project.id).not.toBe(root)
      expect(a.project.id).not.toBe(b.project.id)

      expect(await Bun.file(path.join(tmp.path, ".git", "opencode")).text()).toBe(a.project.id)
      expect(await Bun.file(path.join(clonePath, ".git", "opencode")).text()).toBe(b.project.id)
    } finally {
      await fs.rm(clonePath, { recursive: true, force: true })
    }
  })
})
