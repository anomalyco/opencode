import { describe, expect, test } from "bun:test"
import type { Project } from "@/runtime/server/types"
import type { SessionInfo } from "@opencode/client/promise"
import { createRoot } from "solid-js"
import { createCommandPaletteCommandEntry, createServerSessionEntries } from "@/shell/commands/palette"
import { matchesCommandPaletteEntry } from "@/shell/commands/dialog"
import { ServerConnection } from "@/runtime/server/registry"
import { getProjectAvatarSource } from "@opencode/ui/project-avatar"

const project: Project = {
  id: "project-1",
  name: "Palette project",
  icon: { override: "home-project-avatar" },
  worktree: "/workspace/project",
  worktrees: [],
  sandboxes: [],
  time: { created: 1, updated: 1, active: 1 },
}

const other: Project = {
  ...project,
  id: "project-2",
  name: "Other project",
  icon: { url: "other-project-avatar" },
  worktree: "/workspace/other",
}

const session: SessionInfo = {
  id: "session-1",
  projectID: project.id,
  agent: "build",
  model: { id: "model-1", providerID: "provider-1" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  location: { directory: project.worktree },
  title: "Palette session",
  time: { created: 1, updated: 2 },
}

describe("command palette sessions", () => {
  test("uses the home project avatar and cancels superseded searches", async () => {
    const server = ServerConnection.Key.make("selected-server")

    const searches: string[] = []
    const gets: string[] = []

    const result = await new Promise<Awaited<ReturnType<ReturnType<typeof createServerSessionEntries>>>>(
      (resolve, reject) => {
        createRoot((dispose) => {
          const search = createServerSessionEntries({
            server,
            projects: () => [other, project],
            load: async (text) => {
              searches.push(text)

              return {
                data: [session, { ...session, id: "archived-session", time: { ...session.time, archived: 3 } }],
              }
            },
            get: async (sessionID) => {
              gets.push(sessionID)

              return session
            },
            untitled: () => "Untitled",
            category: () => "Sessions",
            recentCategory: () => "Recent sessions",
          })

          const first = search("palette")
          const second = search("palette session")
          Promise.all([first, second])
            .then(([cancelled, entries]) => {
              expect(cancelled).toEqual([])
              resolve(entries)
            })
            .catch(reject)
            .finally(dispose)
        })
      },
    )

    expect(searches).toEqual(["palette session"])
    expect(gets).toEqual([])
    expect(result).toHaveLength(1)
    expect(getProjectAvatarSource(result[0]?.project?.id, result[0]?.project?.icon)).toBe("home-project-avatar")
    expect(result[0]).toMatchObject({
      server,
      sessionID: session.id,
      description: project.name,
      project: { id: project.id, icon: project.icon },
    })
  })

  test("loads an exact session when the query looks like an ID", async () => {
    const exact = { ...session, id: "ses_12345678901234567890123456", title: "Exact session" }
    const gets: string[] = []

    const result = await new Promise<Awaited<ReturnType<ReturnType<typeof createServerSessionEntries>>>>(
      (resolve, reject) => {
        createRoot((dispose) => {
          const search = createServerSessionEntries({
            server: ServerConnection.Key.make("selected-server"),
            projects: () => [project],
            load: async () => ({ data: [] }),
            get: async (sessionID) => {
              gets.push(sessionID)

              return exact
            },
            untitled: () => "Untitled",
            category: () => "Sessions",
            recentCategory: () => "Recent sessions",
          })

          search(exact.id).then(resolve, reject).finally(dispose)
        })
      },
    )

    expect(gets).toEqual([exact.id])
    expect(result).toMatchObject([{ sessionID: exact.id, title: exact.title }])
  })

  test("matches known and loaded sessions synchronously while remote search is pending", async () => {
    const server = ServerConnection.Key.make("selected-server")

    const remote = {
      ...session,
      id: "session-2",
      title: "Remote palette session",
      time: { created: 2, updated: 4 },
    }

    await createRoot(async (dispose) => {
      try {
        const sessions = createServerSessionEntries({
          server,
          known: () => [session],
          projects: () => [project],
          load: async () => ({ data: [remote] }),
          get: async () => session,
          untitled: () => "Untitled",
          category: () => "Session",
          recentCategory: () => "Recent sessions",
        })

        expect(sessions.items("")).toMatchObject([
          { sessionID: session.id, title: session.title, category: "Recent sessions" },
        ])
        expect(sessions.items("palette")).toMatchObject([
          { sessionID: session.id, title: session.title, category: "Session" },
        ])

        await sessions.search("remote")
        expect(sessions.items("palette")).toMatchObject([
          { sessionID: remote.id, title: remote.title, category: "Session" },
          { sessionID: session.id, title: session.title, category: "Session" },
        ])
      } finally {
        dispose()
      }
    })
  })
})

describe("command palette commands", () => {
  test("match their keywords as well as their title", () => {
    const entry = createCommandPaletteCommandEntry(
      { id: "debug.toggle", title: "Toggle debug bar", keywords: "dev bar developer tools diagnostics" },
      "View",
    )

    expect(matchesCommandPaletteEntry(entry, "dev bar")).toBe(true)
    expect(matchesCommandPaletteEntry(entry, "Diagnostics")).toBe(true)
    expect(matchesCommandPaletteEntry(entry, "terminal")).toBe(false)
  })

  test("match a session by its title, not by its group name, as the server does", () => {
    const entry = { id: "session:tabs", type: "session" as const, title: "Fix tabs", category: "Session" }

    expect(matchesCommandPaletteEntry(entry, "tabs")).toBe(true)
    expect(matchesCommandPaletteEntry(entry, "session")).toBe(false)
  })
})
