import { execFile } from "node:child_process"
import { DatabaseSync } from "node:sqlite"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
type Value = string | number | bigint | Uint8Array | null

export type ProjectRow = {
  id: string
  worktree: string
  name?: string | null
  worktree_name?: string | null
  latest_session_title?: string | null
  icon_color?: string | null
  startup_command?: string | null
  time_updated?: number | null
  sandbox_count?: number | null
  has_icon?: number | null
}

export type SessionDirectoryRow = {
  id: string
  directory: string
  latest_session_title?: string | null
  time_updated?: number | null
}

export type ProjectSessionRow = {
  id: string
  project_id: string
  title?: string | null
  updated_at?: number | null
  waiting?: number | null
}

export type SessionRow = {
  id: string
  directory: string
  title?: string | null
  updated_at?: number | null
  waiting?: number | null
}

type Opts = {
  bin?: string
  dbPath?: string
}

function safe(input: string) {
  return input.replace(/[^a-zA-Z0-9._-]/g, "-")
}

function data() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "opencode")
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "opencode")
}

function fallback() {
  const file = process.env.OPENCODE_DB
  if (file) return file === ":memory:" || path.isAbsolute(file) ? file : path.join(data(), file)
  const channel = process.env.OPENCODE_CHANNEL ?? "latest"
  if (["latest", "beta"].includes(channel) || process.env.OPENCODE_DISABLE_CHANNEL_DB === "true") {
    return path.join(data(), "opencode.db")
  }
  return path.join(data(), `opencode-${safe(channel)}.db`)
}

function marks(size: number) {
  return Array.from({ length: size }, () => "?").join(", ")
}

export function createLocal(opts: Opts = {}) {
  let file: Promise<string> | undefined
  let db: DatabaseSync | undefined

  const getPath = async () => {
    if (opts.dbPath) return opts.dbPath
    file ??= opts.bin
      ? execFileAsync(opts.bin, ["db", "path"]).then((result: { stdout: string }) => result.stdout.trim())
      : Promise.resolve(fallback())
    return file
  }

  const conn = async () => {
    db ??= new DatabaseSync(await getPath())
    return db
  }

  const all = async <T>(query: string, args: Value[] = []) => {
    return (await conn()).prepare(query).all(...args) as T[]
  }

  const run = async (query: string, args: Value[] = []) => {
    ;(await conn()).prepare(query).run(...args)
  }

  return {
    path: getPath,
    close() {
      db?.close()
      db = undefined
    },
    async listProjects() {
      return all<ProjectRow>(
        [
          "select id, worktree, name,",
          "(select nullif(w.name, '') from workspace w where w.directory = project.worktree order by rowid desc limit 1) as worktree_name,",
          "(select nullif(s.title, '') from session s where s.project_id = project.id and s.parent_id is null and s.time_archived is null order by coalesce(s.time_updated, s.time_created) desc limit 1) as latest_session_title,",
          "icon_color, json_extract(commands, '$.start') as startup_command,",
          "time_updated, coalesce(json_array_length(sandboxes), 0) as sandbox_count,",
          "case when icon_url is not null and icon_url != '' then 1 else 0 end as has_icon",
          "from project",
          "where worktree != '/'",
          "order by coalesce(time_updated, 0) desc, coalesce(name, worktree) asc",
        ].join(" "),
      )
    },
    async listSessionOnlyProjects() {
      return all<SessionDirectoryRow>(
        [
          "select min(id) as id, directory,",
          "(select nullif(s2.title, '') from session s2 where s2.directory = s1.directory and s2.parent_id is null and s2.time_archived is null order by coalesce(s2.time_updated, s2.time_created) desc limit 1) as latest_session_title,",
          "max(coalesce(time_updated, time_created)) as time_updated",
          "from session s1",
          "where directory != '/'",
          "and parent_id is null",
          "and time_archived is null",
          "and project_id = 'global'",
          "and not exists (select 1 from project p where p.worktree = s1.directory)",
          "group by directory",
          "order by max(coalesce(time_updated, time_created)) desc, directory asc",
        ].join(" "),
      )
    },
    async listProjectSessions(ids: string[]) {
      if (!ids.length) return [] as ProjectSessionRow[]
      return all<ProjectSessionRow>(
        [
          "with latest_assistant as (",
          "select session_id, time_created, json_extract(data, '$.time.completed') as completed,",
          "row_number() over (partition by session_id order by time_created desc) as rn",
          "from message",
          "where json_extract(data, '$.role') = 'assistant'",
          "),",
          "latest_user as (",
          "select session_id, time_created, row_number() over (partition by session_id order by time_created desc) as rn",
          "from message",
          "where json_extract(data, '$.role') = 'user'",
          "),",
          `known_projects as (select id, worktree, name from project where id in (${marks(ids.length)}))`,
          "select s.id, s.project_id, coalesce(s.title, p.name, p.worktree) as title,",
          "coalesce(s.time_updated, s.time_created) as updated_at,",
          "case when la.time_created is not null and la.completed is not null and coalesce(lu.time_created, 0) < la.time_created then 1 else 0 end as waiting",
          "from session s",
          "join known_projects p on p.id = s.project_id",
          "left join latest_assistant la on la.session_id = s.id and la.rn = 1",
          "left join latest_user lu on lu.session_id = s.id and lu.rn = 1",
          "where s.parent_id is null",
          "and s.time_archived is null",
          "order by coalesce(s.time_updated, s.time_created) desc",
        ].join(" "),
        ids,
      )
    },
    async listSessions(ids: string[]) {
      if (!ids.length) return [] as SessionRow[]
      return all<SessionRow>(
        [
          "with latest_assistant as (",
          "select session_id, time_created, json_extract(data, '$.time.completed') as completed,",
          "row_number() over (partition by session_id order by time_created desc) as rn",
          "from message",
          "where json_extract(data, '$.role') = 'assistant'",
          "),",
          "latest_user as (",
          "select session_id, time_created, row_number() over (partition by session_id order by time_created desc) as rn",
          "from message",
          "where json_extract(data, '$.role') = 'user'",
          "),",
          `known_projects as (select id, worktree, name from project where id in (${marks(ids.length)}))`,
          "select s.id, coalesce(s.directory, p.worktree) as directory, coalesce(s.title, p.name, p.worktree) as title,",
          "coalesce(s.time_updated, s.time_created) as updated_at,",
          "case when la.time_created is not null and la.completed is not null and coalesce(lu.time_created, 0) < la.time_created then 1 else 0 end as waiting",
          "from session s",
          "join known_projects p on p.id = s.project_id",
          "left join latest_assistant la on la.session_id = s.id and la.rn = 1",
          "left join latest_user lu on lu.session_id = s.id and lu.rn = 1",
          "where s.parent_id is null",
          "and s.time_archived is null",
          "order by coalesce(s.time_updated, s.time_created) desc",
          "limit 200",
        ].join(" "),
        ids,
      )
    },
    async fetchProjectIcons(ids: string[]) {
      if (!ids.length) return new Map<string, string>()
      return new Map(
        (
          await all<{ id: string; icon_url: string }>(
            [
              "select id, icon_url",
              "from project",
              `where id in (${marks(ids.length)}) and icon_url is not null and icon_url != ''`,
            ].join(" "),
            ids,
          )
        ).map((row) => [row.id, row.icon_url]),
      )
    },
    async saveProjectIcon(worktree: string, icon: string) {
      await run("update project set icon_url = ? where worktree = ?", [icon, worktree])
    },
  }
}
