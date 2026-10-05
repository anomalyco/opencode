import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import { appendKnownProjects, closeHomeProject, errorMessage, projectForSession, toggleHomeProjectSelection } from "./helpers"
import { ServerConnection } from "@/runtime/server/registry"
import type { Project as ServerProject } from "@/runtime/server/types"

const serverKey = ServerConnection.Key.make

const session = (input: Partial<SessionInfo> & Pick<SessionInfo, "id"> & { directory: string }) =>
  ({
    projectID: "project",
    title: "",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    parentID: undefined,
    time: { created: 0, updated: 0, archived: undefined },
    ...input,
    location: { directory: input.directory },
    directory: undefined,
  }) as SessionInfo

type Project = {
  id: string
  worktree: string
  sandboxes: string[]
  worktrees?: { directory: string; strategy?: string }[]
}

const enriched: { name: string; project: Project }[] = [
  {
    name: "matching project id",
    project: {
      id: "project",
      worktree: "/repo",
      sandboxes: ["/workspaces/feature"],
      worktrees: [{ directory: "/repo" }, { directory: "/workspaces/feature", strategy: "git" }],
    },
  },
  { name: "stale project id", project: { id: "updated", worktree: "/repo", sandboxes: ["/workspaces/feature"] } },
]

describe("layout workspace helpers", () => {
  test.each(enriched)("keeps the enriched project for a nested workspace session ($name)", ({ project }) => {
    expect(
      projectForSession(session({ id: "feature", directory: "/workspaces/feature/packages/app" }), [project]),
    ).toBe(project)
  })

  test("scopes home project selection by server", () => {
    expect(
      toggleHomeProjectSelection(undefined, serverKey("https://debian.example"), "/home/luke/repos/amazon"),
    ).toEqual({
      server: serverKey("https://debian.example"),
      directory: "/home/luke/repos/amazon",
    })
    expect(
      toggleHomeProjectSelection(
        { server: serverKey("https://windows.example"), directory: "/home/luke/repos/amazon" },
        serverKey("https://debian.example"),
        "/home/luke/repos/amazon",
      ),
    ).toEqual({ server: serverKey("https://debian.example"), directory: "/home/luke/repos/amazon" })
    expect(
      toggleHomeProjectSelection(
        { server: serverKey("https://debian.example"), directory: "/home/luke/repos/amazon" },
        serverKey("https://debian.example"),
        "/home/luke/repos/amazon",
      ),
    ).toEqual({ server: serverKey("https://debian.example") })
  })

  test("closes a home project through its server context", () => {
    const closed: string[] = []

    expect(
      closeHomeProject(
        { server: serverKey("https://windows.example"), directory: "/shared" },
        serverKey("https://debian.example"),
        { close: (directory) => closed.push(directory) },
        "/shared",
      ),
    ).toEqual({ server: serverKey("https://windows.example"), directory: "/shared" })
    expect(closed).toEqual(["/shared"])
    expect(
      closeHomeProject(
        { server: serverKey("https://debian.example"), directory: "/shared" },
        serverKey("https://debian.example"),
        { close: (directory) => closed.push(directory) },
        "/shared",
      ),
    ).toEqual({ server: serverKey("https://debian.example") })
  })

  test("extracts api error message and fallback", () => {
    expect(errorMessage({ data: { message: "boom" } }, "fallback")).toBe("boom")
    expect(errorMessage(new Error("broken"), "fallback")).toBe("broken")
    expect(errorMessage("unknown", "fallback")).toBe("fallback")
  })

  test("appends never-opened server projects after the opened ones, newest first", () => {
    const opened = [{ id: "opened", worktree: "/opened", expanded: true }]
    const result = appendKnownProjects(opened, [knownProject("/old", 5), knownProject("/new", 9)])

    expect(result).toEqual([
      { id: "opened", worktree: "/opened", expanded: true },
      { ...knownProject("/new", 9), expanded: false },
      { ...knownProject("/old", 5), expanded: false },
    ])
  })

  test("skips server projects that are already opened across path separators", () => {
    const opened = [{ id: "opened", worktree: "D:\\repo", expanded: true }]
    const result = appendKnownProjects(opened, [knownProject("D:/repo", 9), knownProject("/other", 3)])

    expect(result.map((project) => project.worktree)).toEqual(["D:\\repo", "/other"])
  })

  test("appends each server project once when the server list repeats a directory", () => {
    const result = appendKnownProjects([], [knownProject("D:/repo", 9), knownProject("D:\\repo", 5)])

    expect(result).toEqual([{ ...knownProject("D:/repo", 9), expanded: false }])
  })

  test("skips server projects without a worktree", () => {
    const result = appendKnownProjects([], [knownProject("", 9), knownProject("/kept", 3)])

    expect(result.map((project) => project.worktree)).toEqual(["/kept"])
  })

  test("keeps the opened list unchanged when the server knows no projects", () => {
    const opened = [{ id: "opened", worktree: "/opened", expanded: true }]

    expect(appendKnownProjects(opened, [])).toEqual(opened)
  })
})

function knownProject(worktree: string, updated: number) {
  return {
    id: worktree || "empty",
    canonical: worktree,
    worktree,
    worktrees: [{ directory: worktree }],
    sandboxes: [],
    time: { created: updated, updated, active: updated },
  } as ServerProject
}
