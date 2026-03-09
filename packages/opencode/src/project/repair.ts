import path from "path"
import { existsSync } from "fs"
import { EOL } from "os"
import { Database, eq, inArray, sql } from "../storage/db"
import { ProjectTable } from "./project.sql"
import { PermissionTable, SessionTable } from "../session/session.sql"
import { WorkspaceTable } from "../control-plane/workspace.sql"
import { git } from "../util/git"
import { Project } from "./project"
import { cachePath, canonical, commonDir, gitpath, legacy, writeCache } from "./identity"

type Row = typeof ProjectTable.$inferSelect
type Info = Project.Info
type PermData = (typeof PermissionTable.$inferInsert)["data"]
type Group = { tops: Set<string>; sessions: Set<string>; workspaces: Set<string> }

function duplicateWorktrees() {
  return Database.use((db) =>
    db
      .select({ worktree: ProjectTable.worktree })
      .from(ProjectTable)
      .groupBy(ProjectTable.worktree)
      // Only repair git-backed duplicates. Sandboxes/worktrees are a git feature.
      .having(sql`sum(case when ${ProjectTable.vcs} = 'git' then 1 else 0 end) > 1`)
      .all()
      .map((x) => x.worktree),
  )
}

function isgit(dir: string) {
  if (!existsSync(dir)) return false
  if (!existsSync(path.join(dir, ".git"))) return false
  return true
}

function legacyRows() {
  return Database.use((db) =>
    db
      .select({ id: ProjectTable.id, worktree: ProjectTable.worktree })
      .from(ProjectTable)
      .where(eq(ProjectTable.vcs, "git"))
      .all(),
  )
    .filter((p) => !!legacy(p.id))
    .filter((p) => isgit(p.worktree))
}

function legacyRefs(ids: string[]) {
  const sessions = Database.use((db) =>
    db
      .select({ id: SessionTable.project_id, directory: SessionTable.directory })
      .from(SessionTable)
      .where(inArray(SessionTable.project_id, ids))
      .all(),
  )
  const perms = Database.use((db) =>
    db
      .select({ id: PermissionTable.project_id })
      .from(PermissionTable)
      .where(inArray(PermissionTable.project_id, ids))
      .all(),
  )
  const workspaces = Database.use((db) =>
    db
      .select({ id: WorkspaceTable.project_id, count: sql<number>`count(*)` })
      .from(WorkspaceTable)
      .where(inArray(WorkspaceTable.project_id, ids))
      .groupBy(WorkspaceTable.project_id)
      .all(),
  )

  return { sessions, perms, workspaces }
}

function actionable(
  id: string,
  input: { total: Map<string, number>; exist: Map<string, number>; pset: Set<string>; wmap: Map<string, number> },
) {
  const all = input.total.get(id) ?? 0
  const ok = input.exist.get(id) ?? 0
  if (ok > 0) return true
  if (all > 0) return false
  return input.pset.has(id) || (input.wmap.get(id) ?? 0) > 0
}

function legacyWorktrees() {
  const rows = legacyRows()

  const ids = rows.map((p) => p.id)
  if (ids.length === 0) return []

  const refs = legacyRefs(ids)

  const total = new Map<string, number>()
  const exist = new Map<string, number>()
  for (const s of refs.sessions) {
    total.set(s.id, (total.get(s.id) ?? 0) + 1)
    if (existsSync(s.directory)) {
      exist.set(s.id, (exist.get(s.id) ?? 0) + 1)
    }
  }
  const pset = new Set(refs.perms.map((x) => x.id))
  const wmap = new Map(refs.workspaces.map((x) => [x.id, x.count]))

  return [...new Set(rows.filter((p) => actionable(p.id, { total, exist, pset, wmap })).map((p) => p.worktree))]
}

function merge(existing: Info, dupes: Row[]) {
  return {
    name: existing.name ?? dupes.map((d) => d.name).find(Boolean) ?? undefined,
    commands: existing.commands ?? dupes.map((d) => d.commands).find(Boolean) ?? undefined,
    icon_url: existing.icon?.url ?? dupes.map((d) => d.icon_url).find(Boolean) ?? undefined,
    icon_color: existing.icon?.color ?? dupes.map((d) => d.icon_color).find(Boolean) ?? undefined,
    sandboxes: [...new Set([...existing.sandboxes, ...dupes.flatMap((d) => d.sandboxes)])],
  }
}

function moveSessionsByProject(db: Database.TxOrDb, from: string[], to: string) {
  db.update(SessionTable).set({ project_id: to }).where(inArray(SessionTable.project_id, from)).run()
}

function moveSessionsById(db: Database.TxOrDb, ids: string[], to: string) {
  db.update(SessionTable).set({ project_id: to }).where(inArray(SessionTable.id, ids)).run()
}

function ensurePermission(
  db: Database.TxOrDb,
  input: {
    target: string
    now: number
    data?: PermData
    sources?: string[]
  },
) {
  const existing = db.select().from(PermissionTable).where(eq(PermissionTable.project_id, input.target)).get()
  if (existing) return
  const source = input.data
    ? { data: input.data }
    : input.sources
      ? db.select().from(PermissionTable).where(inArray(PermissionTable.project_id, input.sources)).get()
      : undefined
  if (!source) return
  db.insert(PermissionTable)
    .values({
      project_id: input.target,
      data: source.data,
      time_created: input.now,
      time_updated: input.now,
    })
    .run()
}

function deletePermissions(db: Database.TxOrDb, ids: string[]) {
  db.delete(PermissionTable).where(inArray(PermissionTable.project_id, ids)).run()
}

function deleteProjects(db: Database.TxOrDb, ids: string[]) {
  db.delete(ProjectTable).where(inArray(ProjectTable.id, ids)).run()
}

function within(root: string, dir: string) {
  const rel = path.relative(root, dir)
  if (!rel) return true
  if (rel.startsWith("..")) return false
  if (path.isAbsolute(rel)) return false
  return true
}

function addref(
  groups: Map<string, Group>,
  root: string,
  input?: { top?: string; session?: string; workspace?: string },
) {
  const group = groups.get(root)
  if (group) {
    if (input?.top) group.tops.add(input.top)
    if (input?.session) group.sessions.add(input.session)
    if (input?.workspace) group.workspaces.add(input.workspace)
    return
  }
  groups.set(root, {
    tops: new Set(input?.top ? [input.top] : []),
    sessions: new Set(input?.session ? [input.session] : []),
    workspaces: new Set(input?.workspace ? [input.workspace] : []),
  })
}

async function legacyGroups(input: {
  baseRoot: string
  sessions: { id: string; directory: string }[]
  workspaces: { id: string; directory: string | null }[]
  perm: boolean
}) {
  const groups = new Map<string, Group>()
  for (const s of input.sessions) {
    if (!existsSync(s.directory)) continue
    const top = await git(["rev-parse", "--show-toplevel"], { cwd: s.directory })
      .then((result) => gitpath(s.directory, result.text()))
      .catch(() => s.directory)

    const common = await commonDir(top)
    if (!common) continue

    addref(groups, path.dirname(common), { top, session: s.id })
  }

  if (input.sessions.length > 0 && groups.size === 0) return

  const roots = [...groups.keys()].sort((a, b) => a.localeCompare(b))
  const pick = (dir: string | null) => {
    if (!dir) return input.baseRoot
    let best = input.baseRoot
    for (const root of roots) {
      if (within(root, dir) && root.length > best.length) best = root
    }
    return best
  }

  for (const w of input.workspaces) {
    addref(groups, pick(w.directory), { workspace: w.id })
  }

  if (groups.size === 0 && (input.perm || input.workspaces.length > 0)) {
    addref(groups, input.baseRoot, { top: input.baseRoot })
  }

  return groups
}

async function resolveId(root: string) {
  const common = await commonDir(root)
  if (!common) return

  const cached = await Bun.file(cachePath(common))
    .text()
    .then((x) => x.trim())
    .catch(() => undefined)

  const canon = canonical(root)
  const fixed = canon?.vcs === "git" && !legacy(canon.id) ? canon.id : undefined

  let id = fixed ?? (cached && !legacy(cached) ? cached : crypto.randomUUID())
  for (let i = 0; i < 3; i++) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row || row.worktree === root) break
    id = crypto.randomUUID()
  }
  if (id !== cached) writeCache(common, id)
  return { common, id }
}

function ensureProject(
  db: Database.TxOrDb,
  input: {
    id: string
    root: string
    src: typeof ProjectTable.$inferSelect | undefined
    tops: Set<string>
    now: number
  },
) {
  const row = db.select().from(ProjectTable).where(eq(ProjectTable.id, input.id)).get()
  if (row) return
  db.insert(ProjectTable)
    .values({
      id: input.id,
      worktree: input.root,
      vcs: "git",
      name: input.src?.name,
      icon_url: input.src?.icon_url,
      icon_color: input.src?.icon_color,
      sandboxes: [...new Set([input.root, ...input.tops])],
      commands: input.src?.commands,
      time_created: input.src?.time_created ?? input.now,
      time_updated: input.now,
      time_initialized: input.src?.time_initialized,
    })
    .run()
}

function moveWorkspaces(db: Database.TxOrDb, ids: string[], project: string) {
  db.update(WorkspaceTable).set({ project_id: project }).where(inArray(WorkspaceTable.id, ids)).run()
}

async function legacyInput(worktree: string) {
  if (!isgit(worktree)) return

  const projects = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.worktree, worktree)).all())
  const olds = projects
    .filter((p) => p.vcs === "git")
    .map((p) => p.id)
    .filter((x): x is string => !!legacy(x))
  if (olds.length === 0) return

  const sessions = Database.use((db) =>
    db
      .select({ id: SessionTable.id, directory: SessionTable.directory })
      .from(SessionTable)
      .where(inArray(SessionTable.project_id, olds))
      .all(),
  )
  const workspaces = Database.use((db) =>
    db
      .select({ id: WorkspaceTable.id, directory: WorkspaceTable.directory })
      .from(WorkspaceTable)
      .where(inArray(WorkspaceTable.project_id, olds))
      .all(),
  )

  const base = await commonDir(worktree)
  if (!base) return
  const baseRoot = path.dirname(base)

  const src = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, olds[0]!)).get())
  const perm = Database.use((db) =>
    db.select().from(PermissionTable).where(eq(PermissionTable.project_id, olds[0]!)).get(),
  )
  if (sessions.length === 0 && workspaces.length === 0 && !perm) return

  const groups = await legacyGroups({ baseRoot, sessions, workspaces, perm: !!perm })
  if (!groups) return

  return { olds, src, perm, groups }
}

function legacyCleanup(olds: string[]) {
  const remaining = Database.use(
    (db) =>
      db
        .select({ count: sql<number>`count(*)` })
        .from(SessionTable)
        .where(inArray(SessionTable.project_id, olds))
        .get()?.count,
  )

  if ((remaining ?? 0) !== 0) return

  Database.transaction((db) => {
    deletePermissions(db, olds)
    deleteProjects(db, olds)
  })
}

async function repairLegacy(worktree: string) {
  const input = await legacyInput(worktree)
  if (!input) return

  for (const [root, group] of input.groups) {
    const resolved = await resolveId(root)
    if (!resolved) continue

    const ids = [...group.sessions]
    const ws = [...group.workspaces]

    Database.transaction((db) => {
      const now = Date.now()

      ensureProject(db, { id: resolved.id, root, src: input.src, tops: group.tops, now })
      if (ids.length > 0) moveSessionsById(db, ids, resolved.id)
      if (ws.length > 0) moveWorkspaces(db, ws, resolved.id)
      if (input.perm) ensurePermission(db, { target: resolved.id, now, data: input.perm.data })
    })
  }

  legacyCleanup(input.olds)
}

async function repairWorktree(worktree: string) {
  const row = canonical(worktree)
  if (!row) return
  if (row.vcs !== "git") return

  const projects = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.worktree, worktree)).all())
  const gitProjects = projects.filter((p) => p.vcs === "git")
  if (gitProjects.length <= 1) return
  const dupes = gitProjects.filter((p) => p.id !== row.id)
  if (dupes.length === 0) return

  const meta = merge(Project.fromRow(row), dupes)
  Database.transaction((db) => {
    const ids = dupes.map((d) => d.id)
    const now = Date.now()

    moveSessionsByProject(db, ids, row.id)
    ensurePermission(db, { target: row.id, now, sources: ids })
    deletePermissions(db, ids)

    db.update(ProjectTable)
      .set({
        name: meta.name,
        icon_url: meta.icon_url,
        icon_color: meta.icon_color,
        commands: meta.commands,
        sandboxes: meta.sandboxes,
        time_updated: now,
      })
      .where(eq(ProjectTable.id, row.id))
      .run()

    deleteProjects(db, ids)
  })

  const common = await commonDir(worktree)
  if (common) writeCache(common, row.id)
}

export async function repairAll() {
  // Repairs performed:
  // 1) migrate legacy git project ids (root-commit hashes) to per-clone UUIDs
  // 2) merge duplicate git project rows for the same worktree (split-brain worktree ids)
  const worktrees = [...new Set([...duplicateWorktrees(), ...legacyWorktrees()])]
  if (worktrees.length === 0) return

  process.stderr.write(`Found projects needing repair. Creating DB backup...${EOL}`)
  const backup = await Database.backup("project-repair")
  process.stderr.write(`DB backup created at: ${backup}${EOL}`)

  for (const worktree of worktrees) {
    await repairLegacy(worktree)
    await repairWorktree(worktree)
  }
  process.stderr.write(
    `Project repair complete. To revert: stop opencode and restore ${backup} (and .bak-wal/.bak-shm if present).${EOL}`,
  )
}
