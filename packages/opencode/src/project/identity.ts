import path from "path"
import { Filesystem } from "../util/filesystem"
import { Database, eq, sql } from "../storage/db"
import { ProjectTable } from "./project.sql"
import { SessionTable } from "../session/session.sql"
import { git } from "../util/git"
import { which } from "../util/which"

export function gitpath(cwd: string, name: string) {
  if (!name) return cwd
  // git output includes trailing newlines; keep path whitespace intact.
  name = name.replace(/[\r\n]+$/, "")
  if (!name) return cwd

  name = Filesystem.windowsPath(name)

  if (path.isAbsolute(name)) return path.normalize(name)
  return path.resolve(cwd, name)
}

export function canonical(worktree: string) {
  const projects = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.worktree, worktree)).all())
  if (projects.length === 0) return
  if (projects.length === 1) return projects[0]

  // Prefer git-backed projects when present. Worktrees/sandboxes are a git feature and
  // the split-brain project ID issue only occurs for git repos.
  const gitProjects = projects.filter((p) => p.vcs === "git")
  const pool = gitProjects.length ? gitProjects : projects

  return Database.use(
    (db) =>
      pool
        .map((p) => ({
          p,
          sessions:
            db
              .select({ count: sql<number>`count(*)` })
              .from(SessionTable)
              .where(eq(SessionTable.project_id, p.id))
              .get()?.count ?? 0,
        }))
        .toSorted((a, b) => b.sessions - a.sessions || a.p.time_created - b.p.time_created)[0]?.p,
  )
}

export function cachePath(dir: string) {
  return path.join(dir, "opencode")
}

export function legacy(id: string) {
  if (/^[0-9a-f]{40}$/i.test(id)) return id
}

export async function commonDir(worktree: string) {
  if (!which("git")) return
  const common = await git(["rev-parse", "--git-common-dir"], { cwd: worktree })
    .then((result) => result.text().trim())
    .catch(() => undefined)
  if (!common) return
  return gitpath(worktree, common)
}

export function writeCache(dir: string, id: string) {
  void Bun.file(cachePath(dir))
    .write(id)
    .catch(() => undefined)
}
