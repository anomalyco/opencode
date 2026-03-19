import { describe, expect, mock, test } from "bun:test"
import { Project } from "../../src/project/project"
import { Log } from "../../src/util/log"
import { $ } from "bun"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Filesystem } from "../../src/util/filesystem"
import { GlobalBus } from "../../src/bus/global"
import { ProjectID } from "../../src/project/schema"
import { SessionID } from "../../src/session/schema"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { PermissionTable, SessionTable } from "../../src/session/session.sql"

Log.init({ print: false })

const gitModule = await import("../../src/util/git")
const originalGit = gitModule.git

type Mode = "none" | "rev-list-fail" | "top-fail" | "common-dir-fail"
let mode: Mode = "none"

mock.module("../../src/util/git", () => ({
  git: (args: string[], opts: { cwd: string; env?: Record<string, string> }) => {
    const cmd = ["git", ...args].join(" ")
    if (
      mode === "rev-list-fail" &&
      cmd.includes("git rev-list") &&
      cmd.includes("--max-parents=0") &&
      cmd.includes("HEAD")
    ) {
      return Promise.resolve({
        exitCode: 128,
        text: () => Promise.resolve(""),
        stdout: Buffer.from(""),
        stderr: Buffer.from("fatal"),
      })
    }
    if (mode === "top-fail" && cmd.includes("git rev-parse") && cmd.includes("--show-toplevel")) {
      return Promise.resolve({
        exitCode: 128,
        text: () => Promise.resolve(""),
        stdout: Buffer.from(""),
        stderr: Buffer.from("fatal"),
      })
    }
    if (mode === "common-dir-fail" && cmd.includes("git rev-parse") && cmd.includes("--git-common-dir")) {
      return Promise.resolve({
        exitCode: 128,
        text: () => Promise.resolve(""),
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

function uid() {
  return SessionID.make(crypto.randomUUID())
}

describe("Project.fromDirectory", () => {
  test("should handle git repository with no commits", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()

    const { project } = await p.fromDirectory(tmp.path)

    expect(project).toBeDefined()
    expect(project.id).toBe(ProjectID.global)
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
    expect(project.id).not.toBe(ProjectID.global)
    expect(project.vcs).toBe("git")
    expect(project.worktree).toBe(tmp.path)

    const opencodeFile = path.join(tmp.path, ".git", "opencode")
    const fileExists = await Filesystem.exists(opencodeFile)
    expect(fileExists).toBe(true)
  })

  test("keeps git vcs when rev-list exits non-zero with empty output", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()

    await withMode("rev-list-fail", async () => {
      const { project } = await p.fromDirectory(tmp.path)
      expect(project.vcs).toBe("git")
      expect(project.id).toBe(ProjectID.global)
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

  test("worktree should share project ID with main repo", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const { project: main } = await p.fromDirectory(tmp.path)

    const worktreePath = path.join(tmp.path, "..", path.basename(tmp.path) + "-wt-shared")
    try {
      await $`git worktree add ${worktreePath} -b shared-${Date.now()}`.cwd(tmp.path).quiet()

      const { project: wt } = await p.fromDirectory(worktreePath)

      expect(wt.id).toBe(main.id)

      // Cache should live in the common .git dir, not the worktree's .git file
      const cache = path.join(tmp.path, ".git", "opencode")
      const exists = await Filesystem.exists(cache)
      expect(exists).toBe(true)
    } finally {
      await $`git worktree remove ${worktreePath}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
    }
  })

  test("separate clones of the same repo should share project ID", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    // Create a bare remote, push, then clone into a second directory
    const bare = tmp.path + "-bare"
    const clone = tmp.path + "-clone"
    try {
      await $`git clone --bare ${tmp.path} ${bare}`.quiet()
      await $`git clone ${bare} ${clone}`.quiet()

      const { project: a } = await p.fromDirectory(tmp.path)
      const { project: b } = await p.fromDirectory(clone)

      expect(b.id).toBe(a.id)
    } finally {
      await $`rm -rf ${bare} ${clone}`.quiet().nothrow()
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

  test("repairs duplicate project IDs for the same worktree", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })

    const worktreePath = path.join(tmp.path, "..", path.basename(tmp.path) + "-worktree")
    try {
      await $`git worktree add ${worktreePath} -b test-branch-${Date.now()}`.cwd(tmp.path).quiet()

      const first = await p.fromDirectory(tmp.path).then((x) => x.project)
      const firstID = uid()
      const dupeID = uid()
      await Database.transaction((db) => {
        db.insert(SessionTable)
          .values({
            id: firstID,
            project_id: first.id,
            parent_id: null,
            slug: firstID,
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
            id: ProjectID.make("dupe-project"),
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
            id: dupeID,
            project_id: ProjectID.make("dupe-project"),
            parent_id: null,
            slug: dupeID,
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
            project_id: ProjectID.make("dupe-project"),
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

      const projects = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.worktree, tmp.path)).all())
      expect(projects.length).toBe(1)

      const session = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, dupeID)).get())
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

    await Database.transaction((db) => {
      db.insert(ProjectTable)
        .values({
          id: ProjectID.make("ng-1"),
          worktree: tmp.path,
          vcs: null,
          sandboxes: [],
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()
      db.insert(ProjectTable)
        .values({
          id: ProjectID.make("ng-2"),
          worktree: tmp.path,
          vcs: null,
          sandboxes: [],
          time_created: Date.now() + 1,
          time_updated: Date.now() + 1,
        })
        .run()
    })

    await p.repairAll()

    const projects = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.worktree, tmp.path)).all())
    expect(projects.length).toBe(2)
  })
})

describe("Project.discover", () => {
  test.skip("should discover favicon.png in root", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const { project } = await p.fromDirectory(tmp.path)

    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await Bun.write(path.join(tmp.path, "favicon.png"), pngData)

    await p.discover(project)

    const refreshed = await p.fromDirectory(tmp.path).then((x) => x.project)
    const updated = Project.get(refreshed.id)
    const projects = Project.list()
    expect(updated).toBeDefined()
    expect(projects.map((x) => x.id)).toContain(refreshed.id)
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, refreshed.id)).get())
    expect(row).toBeDefined()
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

    await expect(
      Project.update({
        projectID: ProjectID.make("nonexistent-project-id"),
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
