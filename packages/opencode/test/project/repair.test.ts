import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Project } from "../../src/project/project"
import { Log } from "../../src/util/log"
import { repairAll } from "../../src/project/repair"
import { tmpdir } from "../fixture/fixture"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { PermissionTable, SessionTable } from "../../src/session/session.sql"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"

Log.init({ print: false })

const pre = `${path.basename(Database.Path)}.before-project-repair.`

describe("repairAll", () => {
  test("repairs duplicate project IDs for the same worktree", async () => {
    const p = Project
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

      await repairAll()

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
    await repairAll()

    const projects = Database.use((db) =>
      db.select().from(ProjectTable).where(eq(ProjectTable.worktree, tmp.path)).all(),
    )
    expect(projects.length).toBe(2)

    const after = await fs.readdir(dir)
    const added = after.filter((f) => !before.includes(f))
    expect(added.some((f) => f.startsWith(pre))).toBe(false)
  })

  test("does not repair when only one git project exists for a worktree", async () => {
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

    await repairAll()

    const projects = Database.use((db) =>
      db.select().from(ProjectTable).where(eq(ProjectTable.worktree, tmp.path)).all(),
    )
    expect(projects.length).toBe(2)

    const after = await fs.readdir(dir)
    const added = after.filter((f) => !before.includes(f))
    expect(added.some((f) => f.startsWith(pre))).toBe(false)
  })

  test("does not repair legacy git project without sessions", async () => {
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

    await repairAll()

    const after = await fs.readdir(dir)
    const added = after.filter((f) => !before.includes(f))
    expect(added.some((f) => f.startsWith(pre))).toBe(false)
  })

  test("does not consider legacy git projects needing repair when session directory is missing", async () => {
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

    await repairAll()

    const mid = await fs.readdir(dir)
    const added1 = mid.filter((f) => !before.includes(f))
    expect(added1.some((f) => f.startsWith(pre))).toBe(false)

    await repairAll()

    const after = await fs.readdir(dir)
    const added2 = after.filter((f) => !mid.includes(f))
    expect(added2.some((f) => f.startsWith(pre))).toBe(false)
  })

  test("does not consider legacy git projects needing repair when worktree is missing", async () => {
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

    await repairAll()

    const after = await fs.readdir(dir)
    const added = after.filter((f) => !before.includes(f))
    expect(added.some((f) => f.startsWith(pre))).toBe(false)
  })

  test("migrates legacy git project without sessions when permission exists", async () => {
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

    await repairAll()

    const mid = await fs.readdir(dir)
    const added1 = mid.filter((f) => !before.includes(f))
    expect(added1.some((f) => f.startsWith(pre))).toBe(true)

    const id = await Bun.file(path.join(tmp.path, ".git", "opencode"))
      .text()
      .then((s) => s.trim())
    expect(id).not.toBe(root)

    const perm = Database.use((db) => db.select().from(PermissionTable).where(eq(PermissionTable.project_id, id)).get())
    expect(perm).toBeDefined()

    await repairAll()

    const after = await fs.readdir(dir)
    const added2 = after.filter((f) => !mid.includes(f))
    expect(added2.some((f) => f.startsWith(pre))).toBe(false)
  })

  test("migrates legacy git project without sessions when workspace exists", async () => {
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

    await repairAll()

    const mid = await fs.readdir(dir)
    const added1 = mid.filter((f) => !before.includes(f))
    expect(added1.some((f) => f.startsWith(pre))).toBe(true)

    const id = await Bun.file(path.join(tmp.path, ".git", "opencode"))
      .text()
      .then((s) => s.trim())
    expect(id).not.toBe(root)

    const ws = Database.use((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.project_id, id)).get())
    expect(ws).toBeDefined()

    await repairAll()

    const after = await fs.readdir(dir)
    const added2 = after.filter((f) => !mid.includes(f))
    expect(added2.some((f) => f.startsWith(pre))).toBe(false)
  })

  test("migrates legacy git project ids during repairAll", async () => {
    const p = Project
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

    await repairAll()

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
    const p = Project
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

      await repairAll()

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
    const p = Project
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

      await repairAll()

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
    const p = Project
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

      await repairAll()

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

    await repairAll()

    const session = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, "ses_missing")).get())
    expect(session?.project_id).toBe(root)

    const project = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, root)).get())
    expect(project).toBeDefined()
  })
})
