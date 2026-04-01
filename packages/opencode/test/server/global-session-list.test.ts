import { describe, expect, test } from "bun:test"
import { mkdir } from "fs/promises"
import path from "path"
import { Database as Sqlite } from "bun:sqlite"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("Session.listGlobal", () => {
  test("includes sessions from sibling local channel databases", async () => {
    await using tmp = await tmpdir()

    const data = path.join(tmp.path, "share", "opencode")
    await mkdir(data, { recursive: true })

    const seed = (file: string, id: string, title: string, worktree: string, updated: number) => {
      const db = new Sqlite(path.join(data, file))
      db.exec(`
        create table project (
          id text primary key,
          name text,
          worktree text not null
        );
        create table session (
          id text primary key,
          project_id text not null,
          workspace_id text,
          parent_id text,
          slug text not null,
          directory text not null,
          title text not null,
          version text not null,
          share_url text,
          summary_additions integer,
          summary_deletions integer,
          summary_files integer,
          summary_diffs text,
          revert text,
          permission text,
          time_created integer not null,
          time_updated integer not null,
          time_compacting integer,
          time_archived integer
        );
      `)
      db.query(`insert into project (id, name, worktree) values (?, ?, ?)`).run("proj-" + id, title, worktree)
      db.query(
        `insert into session (
          id, project_id, workspace_id, parent_id, slug, directory, title, version,
          share_url, summary_additions, summary_deletions, summary_files, summary_diffs,
          revert, permission, time_created, time_updated, time_compacting, time_archived
        ) values (?, ?, null, null, ?, ?, ?, '0', null, null, null, null, null, null, null, ?, ?, null, null)`,
      ).run(id, "proj-" + id, id, worktree, title, updated - 1, updated)
      db.close()
    }

    seed("opencode-dev.db", "ses_dev", "dev session", "/tmp/dev", 200)

    const cmd = [
      "bun",
      "-e",
      [
        'const { Session } = await import("./src/session")',
        "const rows = [...Session.listGlobal({ limit: 10 })]",
        "console.log(JSON.stringify(rows.map((row) => ({ id: row.id, title: row.title, worktree: row.project?.worktree }))))",
      ].join(";"),
    ]

    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[0] !== "OPENCODE_DB" && entry[1] !== undefined,
      ),
    )

    const proc = Bun.spawn(cmd, {
      cwd: path.join(import.meta.dir, "..", ".."),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        XDG_DATA_HOME: path.join(tmp.path, "share"),
        XDG_CACHE_HOME: path.join(tmp.path, "cache"),
        XDG_CONFIG_HOME: path.join(tmp.path, "config"),
        XDG_STATE_HOME: path.join(tmp.path, "state"),
        OPENCODE_TEST_HOME: path.join(tmp.path, "home"),
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
      },
    })

    const text = await new Response(proc.stdout).text()
    const code = await proc.exited

    expect(code).toBe(0)
    expect(JSON.parse(text)).toEqual([{ id: "ses_dev", title: "dev session", worktree: "/tmp/dev" }])
  })

  test("lists sessions across projects with project metadata", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    const firstSession = await Instance.provide({
      directory: first.path,
      fn: async () => Session.create({ title: "first-session" }),
    })
    const secondSession = await Instance.provide({
      directory: second.path,
      fn: async () => Session.create({ title: "second-session" }),
    })

    const sessions = [...Session.listGlobal({ limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).toContain(firstSession.id)
    expect(ids).toContain(secondSession.id)

    const firstProject = Project.get(firstSession.projectID)
    const secondProject = Project.get(secondSession.projectID)

    const firstItem = sessions.find((session) => session.id === firstSession.id)
    const secondItem = sessions.find((session) => session.id === secondSession.id)

    expect(firstItem?.project?.id).toBe(firstProject?.id)
    expect(firstItem?.project?.worktree).toBe(firstProject?.worktree)
    expect(secondItem?.project?.id).toBe(secondProject?.id)
    expect(secondItem?.project?.worktree).toBe(secondProject?.worktree)
  })

  test("excludes archived sessions by default", async () => {
    await using tmp = await tmpdir({ git: true })

    const archived = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ title: "archived-session" }),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.setArchived({ sessionID: archived.id, time: Date.now() }),
    })

    const sessions = [...Session.listGlobal({ limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).not.toContain(archived.id)

    const allSessions = [...Session.listGlobal({ limit: 200, archived: true })]
    const allIds = allSessions.map((session) => session.id)

    expect(allIds).toContain(archived.id)
  })

  test("supports cursor pagination", async () => {
    await using tmp = await tmpdir({ git: true })

    const first = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ title: "page-one" }),
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ title: "page-two" }),
    })

    const page = [...Session.listGlobal({ directory: tmp.path, limit: 1 })]
    expect(page.length).toBe(1)
    expect(page[0].id).toBe(second.id)

    const next = [...Session.listGlobal({ directory: tmp.path, limit: 10, cursor: page[0].time.updated })]
    const ids = next.map((session) => session.id)

    expect(ids).toContain(first.id)
    expect(ids).not.toContain(second.id)
  })
})
