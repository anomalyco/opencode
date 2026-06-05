import { describe, expect, test } from "bun:test"
import type { Project, UiProjectView } from "@opencode-ai/sdk/v2/client"
import {
  projectViewEntryForDirectory,
  projectViewDirectoryKey,
  shouldOpenProjectViewDirectory,
  shouldTouchProjectViewDirectory,
} from "./project-view-helpers"

describe("project-view helpers", () => {
  test("matches project entries by normalized path key", () => {
    const view = viewWithProjects([project("/repo")])

    expect(projectViewEntryForDirectory(view, "/repo///")?.project.worktree).toBe("/repo")
  })

  test("suppresses duplicate opens while current or in flight", () => {
    const inFlight = new Set<string>()
    const view = viewWithProjects([project("/repo")])

    expect(shouldOpenProjectViewDirectory({ view, directory: "/repo///", inFlight })).toBe(false)

    inFlight.add(projectViewDirectoryKey("/other"))
    expect(shouldOpenProjectViewDirectory({ view, directory: "/other", inFlight })).toBe(false)
    expect(shouldOpenProjectViewDirectory({ view, directory: "/fresh", inFlight })).toBe(true)
  })

  test("suppresses duplicate opens for pending project entries", () => {
    const inFlight = new Set<string>()
    const view = viewWithProjects([pendingProject("/repo")])

    expect(projectViewEntryForDirectory(view, "/repo///")?.project.id).toBe("")
    expect(shouldOpenProjectViewDirectory({ view, directory: "/repo///", inFlight })).toBe(false)
  })

  test("suppresses duplicate last-project touches while current or in flight", () => {
    const inFlight = new Set<string>()
    const view = viewWithProjects([project("/repo")], project("/repo"))

    expect(shouldTouchProjectViewDirectory({ view, directory: "/repo///", inFlight })).toBe(false)

    inFlight.add(projectViewDirectoryKey("/other"))
    expect(shouldTouchProjectViewDirectory({ view, directory: "/other", inFlight })).toBe(false)
    expect(shouldTouchProjectViewDirectory({ view, directory: "/fresh", inFlight })).toBe(true)
  })
})

function project(worktree: string): Project {
  return {
    id: worktree,
    worktree,
    time: { created: 0, updated: 0 },
    sandboxes: [],
  }
}

function pendingProject(worktree: string): Project {
  return {
    id: "",
    worktree,
    time: { created: 0, updated: 0 },
    sandboxes: [],
  }
}

function viewWithProjects(projects: Project[], lastProject?: Project): UiProjectView {
  return {
    projects: projects.map((item, position) => ({ project: item, position, expanded: true })),
    lastProject,
  }
}
