import { describe, expect, mock, test } from "bun:test"
import { Project } from "../../src/project/project"
import { Log } from "../../src/util/log"
import { $ } from "bun"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Filesystem } from "../../src/util/filesystem"
import { GlobalBus } from "../../src/bus/global"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { PermissionTable, SessionTable } from "../../src/session/session.sql"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import fs from "fs/promises"

Log.init({ print: false })

const gitModule = await import("../../src/util/git")
const originalGit = gitModule.git

type Mode = "none" | "head-fail" | "top-fail" | "common-dir-fail"
let mode: Mode = "none"

mock.module("../../src/util/git", () => ({
  git: (args: string[], opts: { cwd: string; env?: Record<string, string> }) => {
    const cmd = ["git", ...args].join(" ")
    if (mode === "head-fail" && cmd.includes("git rev-parse") && cmd.includes("--verify") && cmd.includes("HEAD")) {
      return Promise.resolve({
        exitCode: 128,
        text: () => "",
        stdout: Buffer.from(""),
        stderr: Buffer.from("fatal"),
      })
    }
    if (mode === "top-fail" && cmd.includes("git rev-parse") && cmd.includes("--show-toplevel")) {
      return Promise.resolve({
        exitCode: 128,
        text: () => "",
        stdout: Buffer.from(""),
        stderr: Buffer.from("fatal"),
      })
    }
    if (mode === "common-dir-fail" && cmd.includes("git rev-parse") && cmd.includes("--git-common-dir")) {
      return Promise.resolve({
        exitCode: 128,
        text: () => "",
        stdout: Buffer.from(""),
        stderr: Buffer.from("fatal"),
      })
    }
    return originalGit(args, opts)
  },
}))

async function withMode(next: Mode, run: () => Promise<void>) {
  const prev = mode
  mode = next
  try {
    await run()
  } finally {
    mode = prev
  }
}

async function loadProject() {
  return (await import("../../src/project/project")).Project
}

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

    const opencodeFile = path.join(tmp.path, ".git", "opencode")
    const fileExists = await Filesystem.exists(opencodeFile)
    expect(fileExists).toBe(false)
  })

  test("should handle git repository with commits", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const { project } = await p.fromDirectory(tmp.path)

    expect(project).toBeDefined()
    expect(project.id).not.toBe("global")
    expect(project.vcs).toBe("git")
    expect(project.worktree).toBe(tmp.path)

    const opencodeFile = path.join(tmp.path, ".git", "opencode")
    const fileExists = await Filesystem.exists(opencodeFile)
    expect(fileExists).toBe(true)
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
  test("repairs duplicate project IDs for the same worktree", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const worktreePath = path.join(tmp.path, "..", path.basename(tmp.path) + "-worktree")
    try {
      await $`git worktree add ${worktreePath} -b test-branch-${Date.now()}`.cwd(tmp.path).quiet()

      const first = await p.fromDirectory(tmp.path).then((x) => x.project)
      Database.transaction((db) => {
        db.insert(SessionTable)
          .values({
            id: "ses_first",
            project_id: first.id,
            parent_id: null,
            slug: "slug",
            directory: tmp.path,
            title: "first session",
            version: "test",
            share_url: null,
            summary_additions: null,
            summary_deletions: null,
            summary_files: null,
            summary_diffs: null,
            revert: null,
            permission: null,
            time_created: Date.now(),
            time_updated: Date.now(),
            time_compacting: null,
            time_archived: null,
          })
          .run()

        db.insert(ProjectTable)
          .values({
            id: "dupe-project",
            worktree: tmp.path,
            vcs: "git",
            sandboxes: [worktreePath],
            icon_url: "data:image/png;base64,AA==",
            time_created: Date.now() + 1,
            time_updated: Date.now() + 1,
          })
          .run()
        db.insert(SessionTable)
          .values({
            id: "ses_dupe",
            project_id: "dupe-project",
            parent_id: null,
            slug: "slug",
            directory: worktreePath,
            title: "dupe session",
            version: "test",
            share_url: null,
            summary_additions: null,
            summary_deletions: null,
            summary_files: null,
            summary_diffs: null,
            revert: null,
            permission: null,
            time_created: Date.now() + 2,
            time_updated: Date.now() + 2,
            time_compacting: null,
            time_archived: null,
          })
          .run()
        db.insert(PermissionTable)
          .values({
            project_id: "dupe-project",
            data: [{ permission: "file.read", pattern: "**", action: "allow" }],
            time_created: Date.now() + 3,
            time_updated: Date.now() + 3,
          })
          .run()
      })

      await p.repairAll()

      const repaired = await p.fromDirectory(worktreePath).then((x) => x.project)
      expect(repaired.id).toBe(first.id)
      expect(repaired.icon?.url).toBe("data:image/png;base64,AA==")

      const projects = Database.use((db) =>
        db.select().from(ProjectTable).where(eq(ProjectTable.worktree, tmp.path)).all(),
      )
      expect(projects.length).toBe(1)

      const session = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, "ses_dupe")).get())
      expect(session?.project_id).toBe(first.id)

      const permission = Database.use((db) =>
        db.select().from(PermissionTable).where(eq(PermissionTable.project_id, first.id)).get(),
      )
      expect(permission).toBeDefined()
    } finally {
      await $`git worktree remove ${worktreePath}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
    }
  })

  test("does not repair non-git duplicate projects", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const stamp = `${Date.now()}-${Math.random()}`

    Database.transaction((db) => {
      db.insert(ProjectTable)
        .values({
          id: `ng-1-${stamp}`,
          worktree: tmp.path,
          vcs: null,
          sandboxes: [],
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()
      db.insert(ProjectTable)
        .values({
          id: `ng-2-${stamp}`,
          worktree: tmp.path,
          vcs: null,
          sandboxes: [],
          time_created: Date.now() + 1,
          time_updated: Date.now() + 1,
        })
        .run()
    })
    const dir = process.env["XDG_DATA_HOME"] + "/opencode"
    const before = await fs.readdir(dir)
    await p.repairAll()

    const projects = Database.use((db) =>
      db.select().from(ProjectTable).where(eq(ProjectTable.worktree, tmp.path)).all(),
    )
    expect(projects.length).toBe(2)

    const after = await fs.readdir(dir)
    const added = after.filter((f) => !before.includes(f))
    expect(added.some((f) => f.startsWith("opencode.db.before-project-repair."))).toBe(false)
  })

  test("does not repair when only one git project exists for a worktree", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const stamp = `${Date.now()}-${Math.random()}`

    Database.transaction((db) => {
      db.insert(ProjectTable)
        .values({
          id: `git-1-${stamp}`,
          worktree: tmp.path,
          vcs: "git",
          sandboxes: [],
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()
      db.insert(ProjectTable)
        .values({
          id: `ng-1-${stamp}`,
          worktree: tmp.path,
          vcs: null,
          sandboxes: [],
          time_created: Date.now() + 1,
          time_updated: Date.now() + 1,
        })
        .run()
    })

    const dir = process.env["XDG_DATA_HOME"] + "/opencode"
    const before = await fs.readdir(dir)

    await p.repairAll()

    const projects = Database.use((db) =>
      db.select().from(ProjectTable).where(eq(ProjectTable.worktree, tmp.path)).all(),
    )
    expect(projects.length).toBe(2)

    const after = await fs.readdir(dir)
    const added = after.filter((f) => !before.includes(f))
    expect(added.some((f) => f.startsWith("opencode.db.before-project-repair."))).toBe(false)
  })

  test("does not repair legacy git project without sessions", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const stamp = `${Date.now()}-${Math.random()}`
    const legacy = `aabbccddeeff00112233445566778899aabbccdd`

    Database.transaction((db) => {
      db.insert(ProjectTable)
        .values({
          id: legacy,
          worktree: tmp.path,
          vcs: "git",
          sandboxes: [],
          time_created: Date.now(),
          time_updated: Date.now(),
          name: `legacy-${stamp}`,
        })
        .run()
    })

    const dir = process.env["XDG_DATA_HOME"] + "/opencode"
    const before = await fs.readdir(dir)

    await p.repairAll()

    const after = await fs.readdir(dir)
    const added = after.filter((f) => !before.includes(f))
    expect(added.some((f) => f.startsWith("opencode.db.before-project-repair."))).toBe(false)
  })

  test("does not consider legacy git projects needing repair when session directory is missing", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const root = await $`git rev-list --max-parents=0 HEAD`
      .cwd(tmp.path)
      .quiet()
      .then((r) => r.text())
      .then((s) => s.trim())

    const missing = path.join(tmp.path, "missing")

    Database.transaction((db) => {
      db.insert(ProjectTable)
        .values({
          id: root,
          worktree: tmp.path,
          vcs: "git",
          sandboxes: [tmp.path],
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()

      db.insert(SessionTable)
        .values({
          id: "ses_missing_dir",
          project_id: root,
          parent_id: null,
          slug: "slug",
          directory: missing,
          title: "legacy session",
          version: "test",
          share_url: null,
          summary_additions: null,
          summary_deletions: null,
          summary_files: null,
          summary_diffs: null,
          revert: null,
          permission: null,
          time_created: Date.now() + 1,
          time_updated: Date.now() + 1,
          time_compacting: null,
          time_archived: null,
        })
        .run()
    })

    const dir = process.env["XDG_DATA_HOME"] + "/opencode"
    const before = await fs.readdir(dir)

    await p.repairAll()

    const mid = await fs.readdir(dir)
    const added1 = mid.filter((f) => !before.includes(f))
    expect(added1.some((f) => f.startsWith("opencode.db.before-project-repair."))).toBe(false)

    await p.repairAll()

    const after = await fs.readdir(dir)
    const added2 = after.filter((f) => !mid.includes(f))
    expect(added2.some((f) => f.startsWith("opencode.db.before-project-repair."))).toBe(false)
  })

  test("does not consider legacy git projects needing repair when worktree is missing", async () => {
    const p = await loadProject()
    const stamp = `${Date.now()}-${Math.random()}`
    const root = `00112233445566778899aabbccddeeff00112233`
    const worktree = path.join(process.env["XDG_DATA_HOME"]!, `missing-worktree-${stamp}`)

    Database.transaction((db) => {
      db.insert(ProjectTable)
        .values({
          id: root,
          worktree,
          vcs: "git",
          sandboxes: [],
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()

      db.insert(SessionTable)
        .values({
          id: `ses_missing_wt_${stamp}`,
          project_id: root,
          parent_id: null,
          slug: "slug",
          directory: path.join(worktree, "sub"),
          title: "legacy session",
          version: "test",
          share_url: null,
          summary_additions: null,
          summary_deletions: null,
          summary_files: null,
          summary_diffs: null,
          revert: null,
          permission: null,
          time_created: Date.now() + 1,
          time_updated: Date.now() + 1,
          time_compacting: null,
          time_archived: null,
        })
        .run()
    })

    const dir = process.env["XDG_DATA_HOME"] + "/opencode"
    const before = await fs.readdir(dir)

    await p.repairAll()

    const after = await fs.readdir(dir)
    const added = after.filter((f) => !before.includes(f))
    expect(added.some((f) => f.startsWith("opencode.db.before-project-repair."))).toBe(false)
  })

  test("migrates legacy git project without sessions when permission exists", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const root = await $`git rev-list --max-parents=0 HEAD`
      .cwd(tmp.path)
      .quiet()
      .then((r) => r.text())
      .then((s) => s.trim())

    Database.transaction((db) => {
      db.insert(ProjectTable)
        .values({
          id: root,
          worktree: tmp.path,
          vcs: "git",
          sandboxes: [tmp.path],
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()

      db.insert(PermissionTable)
        .values({
          project_id: root,
          data: [],
          time_created: Date.now() + 1,
          time_updated: Date.now() + 1,
        })
        .run()
    })

    const dir = process.env["XDG_DATA_HOME"] + "/opencode"
    const before = await fs.readdir(dir)

    await p.repairAll()

    const mid = await fs.readdir(dir)
    const added1 = mid.filter((f) => !before.includes(f))
    expect(added1.some((f) => f.startsWith("opencode.db.before-project-repair."))).toBe(true)

    const id = await Bun.file(path.join(tmp.path, ".git", "opencode"))
      .text()
      .then((s) => s.trim())
    expect(id).not.toBe(root)

    const perm = Database.use((db) => db.select().from(PermissionTable).where(eq(PermissionTable.project_id, id)).get())
    expect(perm).toBeDefined()

    await p.repairAll()

    const after = await fs.readdir(dir)
    const added2 = after.filter((f) => !mid.includes(f))
    expect(added2.some((f) => f.startsWith("opencode.db.before-project-repair."))).toBe(false)
  })

  test("migrates legacy git project without sessions when workspace exists", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const root = await $`git rev-list --max-parents=0 HEAD`
      .cwd(tmp.path)
      .quiet()
      .then((r) => r.text())
      .then((s) => s.trim())

    Database.transaction((db) => {
      db.insert(ProjectTable)
        .values({
          id: root,
          worktree: tmp.path,
          vcs: "git",
          sandboxes: [tmp.path],
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()

      db.insert(WorkspaceTable)
        .values({
          id: `ws_${Date.now()}`,
          type: "worktree",
          branch: null,
          name: "ws",
          directory: tmp.path,
          extra: null,
          project_id: root,
        })
        .run()
    })

    const dir = process.env["XDG_DATA_HOME"] + "/opencode"
    const before = await fs.readdir(dir)

    await p.repairAll()

    const mid = await fs.readdir(dir)
    const added1 = mid.filter((f) => !before.includes(f))
    expect(added1.some((f) => f.startsWith("opencode.db.before-project-repair."))).toBe(true)

    const id = await Bun.file(path.join(tmp.path, ".git", "opencode"))
      .text()
      .then((s) => s.trim())
    expect(id).not.toBe(root)

    const ws = Database.use((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.project_id, id)).get())
    expect(ws).toBeDefined()

    await p.repairAll()

    const after = await fs.readdir(dir)
    const added2 = after.filter((f) => !mid.includes(f))
    expect(added2.some((f) => f.startsWith("opencode.db.before-project-repair."))).toBe(false)
  })

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

  test("migrates legacy git project ids during repairAll", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const root = await $`git rev-list --max-parents=0 HEAD`
      .cwd(tmp.path)
      .quiet()
      .then((r) => r.text())
      .then((s) => s.trim())

    await Bun.write(path.join(tmp.path, ".git", "opencode"), root)

    Database.transaction((db) => {
      db.insert(ProjectTable)
        .values({
          id: root,
          worktree: tmp.path,
          vcs: "git",
          sandboxes: [tmp.path],
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()

      db.insert(SessionTable)
        .values({
          id: "ses_legacy",
          project_id: root,
          parent_id: null,
          slug: "slug",
          directory: tmp.path,
          title: "legacy session",
          version: "test",
          share_url: null,
          summary_additions: null,
          summary_deletions: null,
          summary_files: null,
          summary_diffs: null,
          revert: null,
          permission: null,
          time_created: Date.now() + 1,
          time_updated: Date.now() + 1,
          time_compacting: null,
          time_archived: null,
        })
        .run()

      db.insert(PermissionTable)
        .values({
          project_id: root,
          data: [{ permission: "file.read", pattern: "**", action: "allow" }],
          time_created: Date.now() + 2,
          time_updated: Date.now() + 2,
        })
        .run()
    })

    await p.repairAll()

    const { project } = await p.fromDirectory(tmp.path)
    expect(project.id).not.toBe("global")
    expect(project.id).not.toBe(root)

    const cache = await Bun.file(path.join(tmp.path, ".git", "opencode"))
      .text()
      .then((s) => s.trim())
    expect(cache).toBe(project.id)

    const session = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, "ses_legacy")).get())
    expect(session?.project_id).toBe(project.id)

    const permission = Database.use((db) =>
      db.select().from(PermissionTable).where(eq(PermissionTable.project_id, project.id)).get(),
    )
    expect(permission).toBeDefined()
  })

  test("splits legacy git project ids across separate clones during repairAll", async () => {
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

      await fs.mkdir(path.join(clonePath, "sub"), { recursive: true })

      Database.transaction((db) => {
        db.insert(ProjectTable)
          .values({
            id: root,
            worktree: tmp.path,
            vcs: "git",
            sandboxes: [tmp.path, clonePath],
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run()

        db.insert(PermissionTable)
          .values({
            project_id: root,
            data: [{ permission: "file.read", pattern: "**", action: "allow" }],
            time_created: Date.now() + 1,
            time_updated: Date.now() + 1,
          })
          .run()

        db.insert(SessionTable)
          .values({
            id: "ses_a",
            project_id: root,
            parent_id: null,
            slug: "slug-a",
            directory: tmp.path,
            title: "a",
            version: "test",
            share_url: null,
            summary_additions: null,
            summary_deletions: null,
            summary_files: null,
            summary_diffs: null,
            revert: null,
            permission: null,
            time_created: Date.now() + 2,
            time_updated: Date.now() + 2,
            time_compacting: null,
            time_archived: null,
          })
          .run()

        db.insert(SessionTable)
          .values({
            id: "ses_b",
            project_id: root,
            parent_id: null,
            slug: "slug-b",
            directory: clonePath,
            title: "b",
            version: "test",
            share_url: null,
            summary_additions: null,
            summary_deletions: null,
            summary_files: null,
            summary_diffs: null,
            revert: null,
            permission: null,
            time_created: Date.now() + 3,
            time_updated: Date.now() + 3,
            time_compacting: null,
            time_archived: null,
          })
          .run()

        db.insert(SessionTable)
          .values({
            id: "ses_sub",
            project_id: root,
            parent_id: null,
            slug: "slug-sub",
            directory: path.join(clonePath, "sub"),
            title: "sub",
            version: "test",
            share_url: null,
            summary_additions: null,
            summary_deletions: null,
            summary_files: null,
            summary_diffs: null,
            revert: null,
            permission: null,
            time_created: Date.now() + 4,
            time_updated: Date.now() + 4,
            time_compacting: null,
            time_archived: null,
          })
          .run()
      })

      await p.repairAll()

      const a = await p.fromDirectory(tmp.path).then((x) => x.project)
      const b = await p.fromDirectory(clonePath).then((x) => x.project)

      expect(a.id).not.toBe(root)
      expect(b.id).not.toBe(root)
      expect(a.id).not.toBe(b.id)

      const sa = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, "ses_a")).get())
      const sb = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, "ses_b")).get())
      const ss = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, "ses_sub")).get())
      expect(sa?.project_id).toBe(a.id)
      expect(sb?.project_id).toBe(b.id)
      expect(ss?.project_id).toBe(b.id)

      const cacheA = await Bun.file(path.join(tmp.path, ".git", "opencode"))
        .text()
        .then((s) => s.trim())
      const cacheB = await Bun.file(path.join(clonePath, ".git", "opencode"))
        .text()
        .then((s) => s.trim())
      expect(cacheA).toBe(a.id)
      expect(cacheB).toBe(b.id)

      const pr = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, root)).get())
      expect(pr).toBeUndefined()

      const pa = Database.use((db) =>
        db.select().from(PermissionTable).where(eq(PermissionTable.project_id, a.id)).get(),
      )
      const pb = Database.use((db) =>
        db.select().from(PermissionTable).where(eq(PermissionTable.project_id, b.id)).get(),
      )
      expect(pa).toBeDefined()
      expect(pb).toBeDefined()
    } finally {
      await fs.rm(clonePath, { recursive: true, force: true })
    }
  })

  test("reuses existing project id for a clone when splitting legacy ids", async () => {
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

      Database.transaction((db) => {
        db.insert(ProjectTable)
          .values({
            id: root,
            worktree: tmp.path,
            vcs: "git",
            sandboxes: [tmp.path, clonePath],
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run()

        db.insert(ProjectTable)
          .values({
            id: "existing-project",
            worktree: clonePath,
            vcs: "git",
            sandboxes: [clonePath],
            time_created: Date.now() + 1,
            time_updated: Date.now() + 1,
          })
          .run()

        db.insert(SessionTable)
          .values({
            id: "ses_existing",
            project_id: root,
            parent_id: null,
            slug: "slug",
            directory: clonePath,
            title: "existing",
            version: "test",
            share_url: null,
            summary_additions: null,
            summary_deletions: null,
            summary_files: null,
            summary_diffs: null,
            revert: null,
            permission: null,
            time_created: Date.now() + 2,
            time_updated: Date.now() + 2,
            time_compacting: null,
            time_archived: null,
          })
          .run()
      })

      await p.repairAll()

      const b = await p.fromDirectory(clonePath).then((x) => x.project)
      expect(b.id).toBe("existing-project")

      expect(await Bun.file(path.join(clonePath, ".git", "opencode")).text()).toBe("existing-project")

      const session = Database.use((db) =>
        db.select().from(SessionTable).where(eq(SessionTable.id, "ses_existing")).get(),
      )
      expect(session?.project_id).toBe("existing-project")
    } finally {
      await fs.rm(clonePath, { recursive: true, force: true })
    }
  })

  test("splits legacy ids across two clones while keeping worktrees attached to their clone", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const clonePath = path.join(tmp.path, "..", path.basename(tmp.path) + "-clone")
    const wtA = path.join(tmp.path, "..", path.basename(tmp.path) + "-wt")
    const wtB = path.join(tmp.path, "..", path.basename(tmp.path) + "-clone-wt")
    try {
      await $`git clone ${tmp.path} ${clonePath}`.quiet()
      await $`git worktree add -b br-a ${wtA}`.cwd(tmp.path).quiet()
      await $`git worktree add -b br-b ${wtB}`.cwd(clonePath).quiet()

      const root = await $`git rev-list --max-parents=0 HEAD`
        .cwd(tmp.path)
        .quiet()
        .then((r) => r.text())
        .then((s) => s.trim())

      await Bun.write(path.join(tmp.path, ".git", "opencode"), root)
      await Bun.write(path.join(clonePath, ".git", "opencode"), root)

      Database.transaction((db) => {
        db.insert(ProjectTable)
          .values({
            id: root,
            worktree: tmp.path,
            vcs: "git",
            sandboxes: [tmp.path],
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run()

        db.insert(SessionTable)
          .values({
            id: "ses_a_root",
            project_id: root,
            parent_id: null,
            slug: "slug-a-root",
            directory: tmp.path,
            title: "a-root",
            version: "test",
            share_url: null,
            summary_additions: null,
            summary_deletions: null,
            summary_files: null,
            summary_diffs: null,
            revert: null,
            permission: null,
            time_created: Date.now() + 1,
            time_updated: Date.now() + 1,
            time_compacting: null,
            time_archived: null,
          })
          .run()

        db.insert(SessionTable)
          .values({
            id: "ses_a_wt",
            project_id: root,
            parent_id: null,
            slug: "slug-a-wt",
            directory: wtA,
            title: "a-wt",
            version: "test",
            share_url: null,
            summary_additions: null,
            summary_deletions: null,
            summary_files: null,
            summary_diffs: null,
            revert: null,
            permission: null,
            time_created: Date.now() + 2,
            time_updated: Date.now() + 2,
            time_compacting: null,
            time_archived: null,
          })
          .run()

        db.insert(SessionTable)
          .values({
            id: "ses_b_root",
            project_id: root,
            parent_id: null,
            slug: "slug-b-root",
            directory: clonePath,
            title: "b-root",
            version: "test",
            share_url: null,
            summary_additions: null,
            summary_deletions: null,
            summary_files: null,
            summary_diffs: null,
            revert: null,
            permission: null,
            time_created: Date.now() + 3,
            time_updated: Date.now() + 3,
            time_compacting: null,
            time_archived: null,
          })
          .run()

        db.insert(SessionTable)
          .values({
            id: "ses_b_wt",
            project_id: root,
            parent_id: null,
            slug: "slug-b-wt",
            directory: wtB,
            title: "b-wt",
            version: "test",
            share_url: null,
            summary_additions: null,
            summary_deletions: null,
            summary_files: null,
            summary_diffs: null,
            revert: null,
            permission: null,
            time_created: Date.now() + 4,
            time_updated: Date.now() + 4,
            time_compacting: null,
            time_archived: null,
          })
          .run()
      })

      await p.repairAll()

      const aRoot = await p.fromDirectory(tmp.path).then((x) => x.project)
      const aWt = await p.fromDirectory(wtA).then((x) => x.project)
      const bRoot = await p.fromDirectory(clonePath).then((x) => x.project)
      const bWt = await p.fromDirectory(wtB).then((x) => x.project)

      expect(aRoot.id).not.toBe(root)
      expect(bRoot.id).not.toBe(root)
      expect(aRoot.id).not.toBe(bRoot.id)

      expect(aWt.id).toBe(aRoot.id)
      expect(bWt.id).toBe(bRoot.id)

      const sa1 = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, "ses_a_root")).get())
      const sa2 = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, "ses_a_wt")).get())
      const sb1 = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, "ses_b_root")).get())
      const sb2 = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, "ses_b_wt")).get())
      expect(sa1?.project_id).toBe(aRoot.id)
      expect(sa2?.project_id).toBe(aRoot.id)
      expect(sb1?.project_id).toBe(bRoot.id)
      expect(sb2?.project_id).toBe(bRoot.id)

      const legacy = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, root)).get())
      expect(legacy).toBeUndefined()
    } finally {
      await $`git worktree remove ${wtA}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
      await $`git worktree remove ${wtB}`
        .cwd(clonePath)
        .quiet()
        .catch(() => {})
      await fs.rm(wtA, { recursive: true, force: true })
      await fs.rm(wtB, { recursive: true, force: true })
      await fs.rm(clonePath, { recursive: true, force: true })
    }
  })

  test("does not delete legacy project when some session directories are missing", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const root = await $`git rev-list --max-parents=0 HEAD`
      .cwd(tmp.path)
      .quiet()
      .then((r) => r.text())
      .then((s) => s.trim())

    Database.transaction((db) => {
      db.insert(ProjectTable)
        .values({
          id: root,
          worktree: tmp.path,
          vcs: "git",
          sandboxes: [tmp.path],
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()

      db.insert(SessionTable)
        .values({
          id: "ses_missing",
          project_id: root,
          parent_id: null,
          slug: "slug",
          directory: path.join(tmp.path, "does-not-exist"),
          title: "missing",
          version: "test",
          share_url: null,
          summary_additions: null,
          summary_deletions: null,
          summary_files: null,
          summary_diffs: null,
          revert: null,
          permission: null,
          time_created: Date.now() + 1,
          time_updated: Date.now() + 1,
          time_compacting: null,
          time_archived: null,
        })
        .run()
    })

    await p.repairAll()

    const session = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, "ses_missing")).get())
    expect(session?.project_id).toBe(root)

    const project = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, root)).get())
    expect(project).toBeDefined()
  })
})

describe("Project.discover", () => {
  test("should discover favicon.png in root", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const { project } = await p.fromDirectory(tmp.path)

    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await Bun.write(path.join(tmp.path, "favicon.png"), pngData)

    await p.discover(project)

    const updated = Project.get(project.id)
    expect(updated).toBeDefined()
    expect(updated!.icon).toBeDefined()
    expect(updated!.icon?.url).toStartWith("data:")
    expect(updated!.icon?.url).toContain("base64")
    expect(updated!.icon?.color).toBeUndefined()
  })

  test("should not discover non-image files", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const { project } = await p.fromDirectory(tmp.path)

    await Bun.write(path.join(tmp.path, "favicon.txt"), "not an image")

    await p.discover(project)

    const updated = Project.get(project.id)
    expect(updated).toBeDefined()
    expect(updated!.icon).toBeUndefined()
  })
})

describe("Project.update", () => {
  test("should update name", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const updated = await Project.update({
      projectID: project.id,
      name: "New Project Name",
    })

    expect(updated.name).toBe("New Project Name")

    const fromDb = Project.get(project.id)
    expect(fromDb?.name).toBe("New Project Name")
  })

  test("should update icon url", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const updated = await Project.update({
      projectID: project.id,
      icon: { url: "https://example.com/icon.png" },
    })

    expect(updated.icon?.url).toBe("https://example.com/icon.png")

    const fromDb = Project.get(project.id)
    expect(fromDb?.icon?.url).toBe("https://example.com/icon.png")
  })

  test("should update icon color", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const updated = await Project.update({
      projectID: project.id,
      icon: { color: "#ff0000" },
    })

    expect(updated.icon?.color).toBe("#ff0000")

    const fromDb = Project.get(project.id)
    expect(fromDb?.icon?.color).toBe("#ff0000")
  })

  test("should update commands", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const updated = await Project.update({
      projectID: project.id,
      commands: { start: "npm run dev" },
    })

    expect(updated.commands?.start).toBe("npm run dev")

    const fromDb = Project.get(project.id)
    expect(fromDb?.commands?.start).toBe("npm run dev")
  })

  test("should throw error when project not found", async () => {
    await using tmp = await tmpdir({ git: true })
    void tmp.path

    return expect(
      Project.update({
        projectID: "nonexistent-project-id",
        name: "Should Fail",
      }),
    ).rejects.toThrow("Project not found: nonexistent-project-id")
  })

  test("should emit GlobalBus event on update", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    let eventFired = false
    let eventPayload: any = null

    GlobalBus.on("event", (data) => {
      eventFired = true
      eventPayload = data
    })

    await Project.update({
      projectID: project.id,
      name: "Updated Name",
    })

    expect(eventFired).toBe(true)
    expect(eventPayload.payload.type).toBe("project.updated")
    expect(eventPayload.payload.properties.name).toBe("Updated Name")
  })

  test("should update multiple fields at once", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)

    const updated = await Project.update({
      projectID: project.id,
      name: "Multi Update",
      icon: { url: "https://example.com/favicon.ico", color: "#00ff00" },
      commands: { start: "make start" },
    })

    expect(updated.name).toBe("Multi Update")
    expect(updated.icon?.url).toBe("https://example.com/favicon.ico")
    expect(updated.icon?.color).toBe("#00ff00")
    expect(updated.commands?.start).toBe("make start")
  })
})
