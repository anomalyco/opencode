import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import type { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
import { loadPathQuery, loadProjectsQuery } from "./bootstrap"
import { ServerScope } from "@/utils/server-scope"
import type { ServerApi } from "@/utils/server"

type ProjectApi = ServerApi["project"]
type WorktreeApi = ServerApi["worktree"]

describe("query keys", () => {
  test("partitions identical directories by server scope", () => {
    const location = {} as ServerApi["location"]
    const remote = "https://debian.example" as typeof ServerScope.local

    expect([...loadPathQuery(ServerScope.local, "/repo", location).queryKey]).toEqual(["local", "/repo", "path"])
    expect([...loadPathQuery(remote, "/repo", location).queryKey]).toEqual(["https://debian.example", "/repo", "path"])
  })

  test("loads current location metadata", async () => {
    const calls: unknown[] = []
    const api = {
      get: async (input: unknown) => {
        calls.push(input)
        return { directory: "/repo/subpath", project: { id: "project", directory: "/repo" } }
      },
    } as ServerApi["location"]

    const result = await new QueryClient().fetchQuery(loadPathQuery(ServerScope.local, "/repo/subpath", api))

    expect(calls).toEqual([{ location: { directory: "/repo/subpath" } }])
    expect(result).toMatchObject({ directory: "/repo/subpath", worktree: "/repo" })
  })

  test("loads projects from the current endpoint", async () => {
    const calls: string[] = []
    const projects = {
      list: async () => [
        { id: "b", canonical: "/b", time: { created: 1, updated: 1 }, sandboxes: [] },
        { id: "a", canonical: "/a", time: { created: 1, updated: 1 }, sandboxes: [] },
      ],
    } as unknown as ProjectApi
    const worktrees = {
      list: async ({ projectID }: { projectID: string }) => {
        calls.push(projectID)
        return [
          { directory: `/${projectID}` },
          { directory: `/${projectID}/clone` },
          { directory: `/${projectID}/copy`, strategy: "git" },
        ]
      },
    } as unknown as WorktreeApi

    const result = await new QueryClient().fetchQuery(loadProjectsQuery(ServerScope.local, projects, worktrees))

    expect(result.map((project) => project.id)).toEqual(["a", "b"])
    expect(result.map((project) => project.sandboxes)).toEqual([
      ["/a/clone", "/a/copy"],
      ["/b/clone", "/b/copy"],
    ])
    expect(result.map((project) => project.worktrees)).toEqual([
      [{ directory: "/a" }, { directory: "/a/clone" }, { directory: "/a/copy", strategy: "git" }],
      [{ directory: "/b" }, { directory: "/b/clone" }, { directory: "/b/copy", strategy: "git" }],
    ])
    expect(calls.toSorted()).toEqual(["a", "b"])
  })

  test("keeps projects whose directory inventory cannot load", async () => {
    const projects = {
      list: async () => [
        { id: "a", canonical: "/a", time: { created: 1, updated: 1 }, sandboxes: [] },
        { id: "b", canonical: "/b", time: { created: 1, updated: 1 }, sandboxes: [] },
      ],
    } as unknown as ProjectApi
    const worktrees = {
      list: async ({ projectID }: { projectID: string }) => {
        if (projectID === "b") throw new Error("unavailable")
        return [{ directory: "/a/copy", strategy: "git" as const }]
      },
    } as unknown as WorktreeApi

    const result = await new QueryClient().fetchQuery(loadProjectsQuery(ServerScope.local, projects, worktrees))

    expect(result.map((project) => ({ id: project.id, sandboxes: project.sandboxes }))).toEqual([
      { id: "a", sandboxes: ["/a/copy"] },
      { id: "b", sandboxes: [] },
    ])
  })

})
