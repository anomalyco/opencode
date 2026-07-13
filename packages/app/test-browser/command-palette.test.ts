import { describe, expect, test } from "bun:test"
import type { GlobalSession, Project } from "@opencode-ai/sdk/v2/client"
import { createRoot } from "solid-js"
import { createServerSessionEntries } from "@/components/command-palette"
import type { LocalProject } from "@/context/layout"
import { ServerConnection } from "@/context/server"
import { getProjectAvatarSource } from "@/pages/layout/helpers"

const stored: Project = {
  id: "project-1",
  name: "Palette project",
  worktree: "/workspace/project",
  sandboxes: [],
  time: { created: 1, updated: 1 },
}

const session: GlobalSession = {
  id: "session-1",
  slug: "session-1",
  projectID: stored.id,
  directory: stored.worktree,
  title: "Palette session",
  version: "1",
  time: { created: 1, updated: 2 },
  project: { id: stored.id, name: stored.name, worktree: stored.worktree },
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
    expect(result).toHaveLength(1)
    expect(getProjectAvatarSource(result[0]?.project?.id, result[0]?.project?.icon)).toBe("home-project-avatar")
    expect(result[0]).toMatchObject({
      server,
      sessionID: session.id,
      description: stored.name,
      project: { id: stored.id, icon: opened.icon },
    })
  })
})
