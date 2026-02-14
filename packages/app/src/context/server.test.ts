import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"

describe("server projects.open guard", () => {
  test("should not add project when directory is undefined", () => {
    const [projects, setProjects] = createStore<{ worktree: string; expanded: boolean }[]>([])

    const oldOpen = (directory: string | undefined) => {
      const current = projects
      if (current.find((x) => x.worktree === directory)) return
      setProjects([{ worktree: directory!, expanded: true }, ...current])
    }

    oldOpen(undefined)
    expect(projects.length).toBe(1)
    expect(projects[0].worktree).toBeUndefined()
    expect(projects[0].expanded).toBe(true)
  })

  test("should prevent adding project with undefined worktree (new guard)", () => {
    const [projects, setProjects] = createStore<{ worktree: string; expanded: boolean }[]>([])

    const newOpen = (directory: string | undefined) => {
      if (!directory) {
        console.error("server.projects.open called with undefined directory")
        return
      }
      const current = projects
      if (current.find((x) => x.worktree === directory)) return
      setProjects([{ worktree: directory, expanded: true }, ...current])
    }

    newOpen(undefined)
    expect(projects.length).toBe(0)

    newOpen("/path/to/project")
    expect(projects.length).toBe(1)
    expect(projects[0].worktree).toBe("/path/to/project")
    expect(projects[0].expanded).toBe(true)
  })
})

describe("corrupt data migration", () => {
  test("should filter out projects without worktree", () => {
    const corruptData = [
      { expanded: true },
      { worktree: "/valid/path", expanded: true },
      { expanded: false },
      { worktree: "/another/path", expanded: false },
    ] as { worktree?: string; expanded: boolean }[]

    const valid = corruptData.filter((p) => p?.worktree)

    expect(valid.length).toBe(2)
    expect(valid[0].worktree).toBe("/valid/path")
    expect(valid[1].worktree).toBe("/another/path")
  })

  test("should detect corrupt entries across all origins", () => {
    const projects: Record<string, { worktree?: string; expanded: boolean }[]> = {
      local: [{ expanded: true }, { worktree: "/home/user/project", expanded: true }],
      "http://server.com": [{ worktree: "/remote/project", expanded: false }, { expanded: true }, { expanded: false }],
    }

    let foundCorrupt = false
    const cleaned: Record<string, { worktree: string; expanded: boolean }[]> = {}

    for (const [key, list] of Object.entries(projects)) {
      const valid = list?.filter((p) => p?.worktree) as { worktree: string; expanded: boolean }[]
      if (valid?.length !== list?.length) {
        foundCorrupt = true
        cleaned[key] = valid
      }
    }

    expect(foundCorrupt).toBe(true)
    expect(cleaned.local.length).toBe(1)
    expect(cleaned["http://server.com"].length).toBe(1)
    expect(cleaned.local[0].worktree).toBe("/home/user/project")
    expect(cleaned["http://server.com"][0].worktree).toBe("/remote/project")
  })

  test("should handle empty or null lists gracefully", () => {
    const projects: Record<string, { worktree?: string; expanded: boolean }[] | null | undefined> = {
      local: null,
      "http://server.com": undefined,
      "http://another.com": [],
    }

    let foundCorrupt = false

    for (const [key, list] of Object.entries(projects)) {
      const valid = list?.filter((p) => p?.worktree)
      if (valid?.length !== list?.length) {
        foundCorrupt = true
      }
    }

    expect(foundCorrupt).toBe(false)
  })
})

describe("enrich function with undefined worktree", () => {
  test("should handle project without worktree gracefully", () => {
    const project = { expanded: true } as { worktree?: string; expanded: boolean }

    expect(() => {
      const dir = project.worktree
      if (!dir) throw new Error("No worktree")
    }).toThrow("No worktree")
  })
})
