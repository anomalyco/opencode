import { describe, expect } from "bun:test"
import { Project } from "@/project/project"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { tmpdirScoped } from "../fixture/fixture"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { WorkspaceTable } from "@opencode-ai/core/control-plane/workspace.sql"
import { eq } from "drizzle-orm"
import { Hash } from "@opencode-ai/core/util/hash"
import { SessionID } from "@/session/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { Effect } from "effect"
import { ProjectV2 } from "@opencode-ai/core/project"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"

const projectTestNode = LayerNode.group([Project.node, Database.node, CrossSpawnSpawner.node])
const it = testEffect(AppNodeBuilder.build(projectTestNode))

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const REMOTE = "git@github.com:identity-test/repo.git"
const legacyRemoteID = ProjectV2.ID.make(Hash.fast("git-remote:github.com/identity-test/repo"))

function addRemote(dir: string) {
  return Effect.promise(() => $`git remote add origin ${REMOTE}`.cwd(dir).quiet())
}

function writeLegacyFile(dir: string, id: string) {
  return Effect.promise(() => Bun.write(path.join(dir, ".git", "opencode"), id))
}

function readIdentityFile(dir: string) {
  return Effect.promise(() => Bun.file(path.join(dir, ".git", "opencode")).text()).pipe(
    Effect.map((content) => JSON.parse(content) as { version: number; repoID: string; repoHash?: string }),
  )
}

function seedProject(opts: { id: ProjectV2.ID; worktree: string; sandboxes?: string[] }) {
  const now = Date.now()
  return Database.Service.use(({ db }) =>
    db
      .insert(ProjectTable)
      .values({
        id: opts.id,
        worktree: AbsolutePath.make(opts.worktree),
        vcs: "git",
        sandboxes: (opts.sandboxes ?? []).map((sandbox) => AbsolutePath.make(sandbox)),
        time_created: now,
        time_updated: now,
      })
      .run()
      .pipe(Effect.orDie),
  )
}

function seedSession(opts: { id: SessionID; dir: string; project: ProjectV2.ID }) {
  const now = Date.now()
  return Database.Service.use(({ db }) =>
    db
      .insert(SessionTable)
      .values({
        id: opts.id,
        project_id: opts.project,
        slug: opts.id,
        directory: opts.dir,
        title: "test",
        version: "0.0.0-test",
        time_created: now,
        time_updated: now,
      })
      .run()
      .pipe(Effect.orDie),
  )
}

function seedWorkspace(opts: { id: WorkspaceV2.ID; project: ProjectV2.ID; dir?: string }) {
  return Database.Service.use(({ db }) =>
    db
      .insert(WorkspaceTable)
      .values({ id: opts.id, type: "local", name: "test", project_id: opts.project, directory: opts.dir })
      .run()
      .pipe(Effect.orDie),
  )
}

function workspaceRow(id: WorkspaceV2.ID) {
  return Database.Service.use(({ db }) =>
    db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id)).get().pipe(Effect.orDie),
  )
}

function sessionProject(id: SessionID) {
  return Database.Service.use(({ db }) =>
    db
      .select()
      .from(SessionTable)
      .where(eq(SessionTable.id, id))
      .get()
      .pipe(
        Effect.orDie,
        Effect.map((row) => row?.project_id),
      ),
  )
}

function projectRow(id: ProjectV2.ID) {
  return Database.Service.use(({ db }) =>
    db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get().pipe(Effect.orDie),
  )
}

function projectCount() {
  return Database.Service.use(({ db }) =>
    db
      .select()
      .from(ProjectTable)
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows.length),
      ),
  )
}

describe("Project identity minting", () => {
  it.live("mints a stable uuid identity for a fresh repo", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const tmp = yield* tmpdirScoped({ git: true })
      yield* addRemote(tmp)

      const first = yield* project.fromDirectory(tmp)

      expect(first.project.id).toMatch(UUID_RE)
      expect(first.project.id).not.toBe(legacyRemoteID)
      expect(first.project.worktree).toBe(tmp)

      const file = yield* readIdentityFile(tmp)
      // The repo-level key is stored beside the identity, byte-identical to
      // the pre-fix derived id so old and new formats agree.
      expect(file).toEqual({ version: 1, repoID: first.project.id, repoHash: legacyRemoteID })
      expect(first.project.repoHash).toBe(legacyRemoteID)

      const second = yield* project.fromDirectory(tmp)
      expect(second.project.id).toBe(first.project.id)
      expect(yield* projectCount()).toBe(1)
    }),
  )

  it.live("two clones of the same repo become distinct projects", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      // Old scheme keyed identity on the normalized remote hash, so two
      // independent checkouts with the same origin model two clones exactly.
      const a = yield* tmpdirScoped({ git: true })
      const b = yield* tmpdirScoped({ git: true })
      yield* addRemote(a)
      yield* addRemote(b)

      const first = yield* project.fromDirectory(a)
      const second = yield* project.fromDirectory(b)

      expect(first.project.id).toMatch(UUID_RE)
      expect(second.project.id).toMatch(UUID_RE)
      expect(second.project.id).not.toBe(first.project.id)
      expect(first.project.worktree).toBe(a)
      expect(second.project.worktree).toBe(b)

      // Distinct identities, same repo-level grouping key: this is what lets
      // a UI unify clones of one repository.
      expect(first.project.repoHash).toBe(legacyRemoteID)
      expect(second.project.repoHash).toBe(legacyRemoteID)

      const firstRow = yield* projectRow(first.project.id)
      expect(firstRow?.sandboxes).not.toContain(b)
      expect(firstRow?.repo_hash).toBe(legacyRemoteID)
      expect(yield* projectCount()).toBe(2)
    }),
  )

  it.live("linked worktree keeps mapping to its clone's project", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const tmp = yield* tmpdirScoped({ git: true })
      yield* addRemote(tmp)
      const worktreePath = path.join(tmp, "..", path.basename(tmp) + "-wt")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          $`git worktree remove --force ${worktreePath}`
            .cwd(tmp)
            .quiet()
            .catch(() => {}),
        ),
      )
      yield* Effect.promise(() => $`git worktree add ${worktreePath} -b test-branch-${Date.now()}`.cwd(tmp).quiet())

      const clone = yield* project.fromDirectory(tmp)
      const linked = yield* project.fromDirectory(worktreePath)

      expect(linked.project.id).toBe(clone.project.id)
      expect(linked.project.worktree).toBe(tmp)
      expect(linked.project.sandboxes).toContain(linked.sandbox)
      expect(yield* projectCount()).toBe(1)
    }),
  )

  it.live("keeps legacy identity when the identity file cannot be written", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const project = yield* Project.Service
      const tmp = yield* tmpdirScoped({ git: true })
      yield* addRemote(tmp)
      const gitDir = path.join(tmp, ".git")
      yield* Effect.addFinalizer(() => Effect.promise(() => fs.chmod(gitDir, 0o755)))
      yield* Effect.promise(() => fs.chmod(gitDir, 0o555))

      const first = yield* project.fromDirectory(tmp)
      const second = yield* project.fromDirectory(tmp)

      // Without a durable identity file, minting would fragment identity on
      // every boot; the legacy derived id must remain in effect instead.
      expect(first.project.id).toBe(legacyRemoteID)
      expect(second.project.id).toBe(legacyRemoteID)
      expect(yield* Effect.promise(() => Bun.file(path.join(gitDir, "opencode")).exists())).toBe(false)
    }),
  )

  it.live("repo first contacted through a linked worktree roots at the main checkout", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const tmp = yield* tmpdirScoped({ git: true })
      yield* addRemote(tmp)
      const worktreePath = path.join(tmp, "..", path.basename(tmp) + "-first-wt")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          $`git worktree remove --force ${worktreePath}`
            .cwd(tmp)
            .quiet()
            .catch(() => {}),
        ),
      )
      yield* Effect.promise(() => $`git worktree add ${worktreePath} -b first-contact-${Date.now()}`.cwd(tmp).quiet())

      // First contact via the worktree, never the root: the project must be
      // rooted at the main checkout, not at the worktree path.
      const viaWorktree = yield* project.fromDirectory(worktreePath)

      expect(viaWorktree.project.id).toMatch(UUID_RE)
      expect(viaWorktree.project.worktree).toBe(tmp)
      expect(viaWorktree.project.sandboxes).toContain(viaWorktree.sandbox)
      expect(viaWorktree.project.sandboxes).not.toContain(tmp)

      const viaRoot = yield* project.fromDirectory(tmp)

      expect(viaRoot.project.id).toBe(viaWorktree.project.id)
      expect(viaRoot.project.worktree).toBe(tmp)
      expect(yield* projectCount()).toBe(1)
    }),
  )

  it.live("empty repo without a remote stays global", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const tmp = yield* tmpdirScoped()
      yield* Effect.promise(() => $`git init`.cwd(tmp).quiet())

      const result = yield* project.fromDirectory(tmp)

      expect(result.project.id).toBe(ProjectV2.ID.global)
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp, ".git", "opencode")).exists())).toBe(false)
    }),
  )
})

describe("Project identity migration", () => {
  it.live("migrates a legacy project to its minted identity once", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const tmp = yield* tmpdirScoped({ git: true })
      yield* addRemote(tmp)
      yield* writeLegacyFile(tmp, legacyRemoteID)
      yield* seedProject({ id: legacyRemoteID, worktree: tmp })
      const sessionID = crypto.randomUUID() as SessionID
      yield* seedSession({ id: sessionID, dir: tmp, project: legacyRemoteID })
      const workspaceID = WorkspaceV2.ID.ascending()
      yield* seedWorkspace({ id: workspaceID, project: legacyRemoteID })

      // A session running inside a managed worktree references the storage
      // path keyed by the legacy id; it must follow the storage re-key.
      const managedID = crypto.randomUUID() as SessionID
      const managedDir = path.join(Global.Path.data, "worktree", legacyRemoteID, "wt1")
      yield* seedSession({ id: managedID, dir: managedDir, project: legacyRemoteID })

      const result = yield* project.fromDirectory(tmp)

      expect(result.project.id).toMatch(UUID_RE)
      expect(yield* projectRow(legacyRemoteID)).toBeUndefined()
      expect(yield* sessionProject(sessionID)).toBe(result.project.id)
      const workspace = yield* Database.Service.use(({ db }) =>
        db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).get().pipe(Effect.orDie),
      )
      expect(workspace?.project_id).toBe(result.project.id)
      const managed = yield* Database.Service.use(({ db }) =>
        db.select().from(SessionTable).where(eq(SessionTable.id, managedID)).get().pipe(Effect.orDie),
      )
      expect(managed?.directory).toBe(path.join(Global.Path.data, "worktree", result.project.id, "wt1"))
      const file = yield* readIdentityFile(tmp)
      // The legacy id in the migrated file is reused as the repo-level key.
      expect(file).toEqual({ version: 1, repoID: result.project.id, repoHash: legacyRemoteID })
      expect(result.project.repoHash).toBe(legacyRemoteID)

      const again = yield* project.fromDirectory(tmp)
      expect(again.project.id).toBe(result.project.id)
      expect(yield* projectCount()).toBe(1)
    }),
  )

  it.live("splits two clones previously merged under one legacy id", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const a = yield* tmpdirScoped({ git: true })
      const b = yield* tmpdirScoped({ git: true })
      yield* addRemote(a)
      yield* addRemote(b)
      // Bug-era state: one shared row, second clone filed as a sandbox of the
      // first, sessions from both directories parented to the shared id.
      yield* seedProject({ id: legacyRemoteID, worktree: a, sandboxes: [b] })
      yield* writeLegacyFile(a, legacyRemoteID)
      yield* writeLegacyFile(b, legacyRemoteID)
      const sessionA = crypto.randomUUID() as SessionID
      const sessionB = crypto.randomUUID() as SessionID
      yield* seedSession({ id: sessionA, dir: a, project: legacyRemoteID })
      yield* seedSession({ id: sessionB, dir: b, project: legacyRemoteID })
      const workspaceB = WorkspaceV2.ID.ascending()
      yield* seedWorkspace({ id: workspaceB, project: legacyRemoteID, dir: b })

      const first = yield* project.fromDirectory(a)

      expect(first.project.id).toMatch(UUID_RE)
      expect(first.project.worktree).toBe(a)
      expect(first.project.sandboxes).not.toContain(b)
      expect(yield* projectRow(legacyRemoteID)).toBeUndefined()

      const second = yield* project.fromDirectory(b)

      expect(second.project.id).toMatch(UUID_RE)
      expect(second.project.id).not.toBe(first.project.id)
      expect(second.project.worktree).toBe(b)
      expect(yield* sessionProject(sessionA)).toBe(first.project.id)
      expect(yield* sessionProject(sessionB)).toBe(second.project.id)
      // Workspaces recorded at the sibling's directory follow it too, not
      // just sessions.
      expect((yield* workspaceRow(workspaceB))?.project_id).toBe(second.project.id)
      expect(yield* projectCount()).toBe(2)
    }),
  )

  it.live("second clone opened first does not adopt the first clone's worktree", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const a = yield* tmpdirScoped({ git: true })
      const b = yield* tmpdirScoped({ git: true })
      yield* addRemote(a)
      yield* addRemote(b)
      yield* seedProject({ id: legacyRemoteID, worktree: a, sandboxes: [b] })
      yield* writeLegacyFile(a, legacyRemoteID)
      yield* writeLegacyFile(b, legacyRemoteID)
      const sessionA = crypto.randomUUID() as SessionID
      const sessionB = crypto.randomUUID() as SessionID
      yield* seedSession({ id: sessionA, dir: a, project: legacyRemoteID })
      yield* seedSession({ id: sessionB, dir: b, project: legacyRemoteID })

      const second = yield* project.fromDirectory(b)

      expect(second.project.worktree).toBe(b)
      expect(second.project.sandboxes).not.toContain(a)
      expect(second.project.sandboxes).not.toContain(b)

      const first = yield* project.fromDirectory(a)

      expect(first.project.id).not.toBe(second.project.id)
      expect(first.project.worktree).toBe(a)
      expect(yield* sessionProject(sessionA)).toBe(first.project.id)
      expect(yield* sessionProject(sessionB)).toBe(second.project.id)
    }),
  )

  it.live("renamed clone keeps its identity, sessions, and refreshed worktree", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const tmp = yield* tmpdirScoped({ git: true })
      yield* addRemote(tmp)
      const renamed = tmp + "-renamed"
      yield* Effect.addFinalizer(() => Effect.promise(() => $`rm -rf ${renamed}`.quiet().nothrow()).pipe(Effect.ignore))

      const before = yield* project.fromDirectory(tmp)
      const sessionID = crypto.randomUUID() as SessionID
      const nestedID = crypto.randomUUID() as SessionID
      yield* seedSession({ id: sessionID, dir: tmp, project: before.project.id })
      yield* seedSession({ id: nestedID, dir: path.join(tmp, "packages", "app"), project: before.project.id })
      const workspaceID = WorkspaceV2.ID.ascending()
      yield* Database.Service.use(({ db }) =>
        db
          .insert(WorkspaceTable)
          .values({ id: workspaceID, type: "local", name: "test", project_id: before.project.id, directory: tmp })
          .run()
          .pipe(Effect.orDie),
      )
      yield* Effect.promise(() => fs.rename(tmp, renamed))

      const after = yield* project.fromDirectory(renamed)

      expect(after.project.id).toBe(before.project.id)
      expect(after.project.worktree).toBe(renamed)
      expect(after.project.sandboxes).not.toContain(renamed)
      expect(yield* sessionProject(sessionID)).toBe(before.project.id)
      expect(yield* projectCount()).toBe(1)

      // Sessions and workspaces recorded at or under the old path follow the
      // move — their directory is the runtime cwd and the old path is dead.
      const rows = yield* Database.Service.use(({ db }) =>
        db.select().from(SessionTable).where(eq(SessionTable.project_id, before.project.id)).all().pipe(Effect.orDie),
      )
      expect(rows.find((row) => row.id === sessionID)?.directory).toBe(renamed)
      expect(rows.find((row) => row.id === nestedID)?.directory).toBe(path.join(renamed, "packages", "app"))
      const workspace = yield* Database.Service.use(({ db }) =>
        db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).get().pipe(Effect.orDie),
      )
      expect(workspace?.directory).toBe(renamed)
    }),
  )
})
