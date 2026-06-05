import { describe, expect, test } from "bun:test"
import type { Project, UiProjectView } from "@opencode-ai/sdk/v2/client"
import {
  projectViewDirectoryKey,
  projectViewEntryForDirectory,
  projectViewProjectDisplayName,
  projectViewResolvedEntryFromOpenResult,
  pruneProjectViewDirectoryAliases,
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

  test("uses directory aliases when a requested path resolves to a canonical project", () => {
    const inFlight = new Set<string>()
    const aliases = new Map([[projectViewDirectoryKey("/mnt/data/repo"), projectViewDirectoryKey("/")]])
    const view = viewWithProjects([project("/")], project("/"))

    expect(projectViewEntryForDirectory(view, "/mnt/data/repo", aliases)?.project.worktree).toBe("/")
    expect(shouldOpenProjectViewDirectory({ view, directory: "/mnt/data/repo", inFlight, aliases })).toBe(
      false,
    )
    expect(shouldTouchProjectViewDirectory({ view, directory: "/mnt/data/repo", inFlight, aliases })).toBe(
      false,
    )
  })

  test("derives a non-empty display name for canonical root aliases", () => {
    const aliases = new Map([[projectViewDirectoryKey("/mnt/data/repo"), projectViewDirectoryKey("/")]])

    expect(projectViewProjectDisplayName(project("/"), aliases)).toBe("repo")
    expect(projectViewProjectDisplayName(project("/"))).toBe("/")
    expect(projectViewProjectDisplayName({ ...project("/"), name: "Workspace" }, aliases)).toBe("Workspace")
  })

  test("prunes directory aliases whose canonical target is no longer visible", () => {
    const aliases = new Map([
      [projectViewDirectoryKey("/mnt/data/repo"), projectViewDirectoryKey("/")],
      [projectViewDirectoryKey("/mnt/data/current"), projectViewDirectoryKey("/current")],
    ])
    const view = viewWithProjects([project("/repo")], project("/current"))

    pruneProjectViewDirectoryAliases(view, aliases)

    expect(aliases.has(projectViewDirectoryKey("/mnt/data/repo"))).toBe(false)
    expect(aliases.get(projectViewDirectoryKey("/mnt/data/current"))).toBe(projectViewDirectoryKey("/current"))
  })

  test("does not infer an open-result alias for a direct requested directory entry", () => {
    const resultView = viewWithProjects([project("/repo")])

    expect(
      projectViewResolvedEntryFromOpenResult({
        preView: viewWithProjects([]),
        resultView,
        directory: "/repo///",
        position: 0,
      }),
    ).toBeUndefined()
  })

  test("infers an open-result alias when the requested position changes from the pre-view", () => {
    const preView = viewWithProjects([project("/existing")])
    const resultView = viewWithProjects([project("/")])

    expect(
      projectViewResolvedEntryFromOpenResult({
        preView,
        resultView,
        directory: "/mnt/data/repo",
        position: 0,
      })?.project.worktree,
    ).toBe("/")
  })

  test("infers an open-result alias from exactly one new returned project key", () => {
    const preView = viewWithProjects([project("/existing")])
    const resultView = viewWithProjects([project("/existing"), project("/")])

    expect(
      projectViewResolvedEntryFromOpenResult({
        preView,
        resultView,
        directory: "/mnt/data/repo",
        position: 0,
      })?.project.worktree,
    ).toBe("/")
  })

  test("does not infer an open-result alias from an unchanged coalesced view", () => {
    const preView = viewWithProjects([project("/existing")])
    const resultView = viewWithProjects([project("/existing")])

    expect(
      projectViewResolvedEntryFromOpenResult({
        preView,
        resultView,
        directory: "/mnt/data/repo",
        position: 0,
      }),
    ).toBeUndefined()
  })

  test("does not infer an open-result alias when new returned project keys are ambiguous", () => {
    const preView = viewWithProjects([project("/existing")])
    const resultView = viewWithProjects([project("/existing"), project("/first"), project("/second")])

    expect(
      projectViewResolvedEntryFromOpenResult({
        preView,
        resultView,
        directory: "/mnt/data/repo",
        position: 0,
      }),
    ).toBeUndefined()
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
