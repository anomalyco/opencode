import { describe, expect, test } from "bun:test"
import type { Project } from "@/runtime/server/types"
import type { SessionInfo } from "@opencode-ai/client/promise"
import { createRoot } from "solid-js"
import { createServerSessionEntries } from "@/shell/commands/palette"
import type { LocalProject } from "@/shell/state/layout"
import { ServerConnection } from "@/runtime/server/registry"
import { getProjectAvatarSource } from "@/shell/layout/helpers"

const stored: Project = {
  id: "project-1",
  name: "Palette project",
  worktree: "/workspace/project",
  sandboxes: [],
  time: { created: 1, updated: 1 },
}

const session: SessionInfo = {
  id: "session-1",
  projectID: stored.id,
  agent: "build",
  model: { id: "model-1", providerID: "provider-1" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  location: { directory: stored.worktree },
  title: "Palette session",
  time: { created: 1, updated: 2 },
}

describe("command palette sessions", () => {
  test("uses the home project avatar and cancels superseded searches", async () => {
    const server = ServerConnection.Key.make("selected-server")
    const opened: LocalProject = {
      ...stored,
      icon: { override: "home-project-avatar" },
      expanded: true,
    }
    const searches: string[] = []
    const gets: string[] = []
    const result = await new Promise<Awaited<ReturnType<ReturnType<typeof createServerSessionEntries>>>>(
      (resolve, reject) => {
        createRoot((dispose) => {
          const search = createServerSessionEntries({
            server,
            opened: () => [opened],
            stored: () => [{ ...stored, icon: { url: "stored-project-avatar" } }],
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
      description: stored.name,
      project: { id: stored.id, icon: opened.icon },
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
            opened: () => [],
            stored: () => [stored],
            load: async () => ({ data: [] }),
            get: async (sessionID) => {
              gets.push(sessionID)
              return exact
            },
            untitled: () => "Untitled",
            category: () => "Sessions",
          })
          search(exact.id).then(resolve, reject).finally(dispose)
        })
      },
    )

    expect(gets).toEqual([exact.id])
    expect(result).toMatchObject([{ sessionID: exact.id, title: exact.title }])
  })
})
