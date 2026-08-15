import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import type { AgentApi, CatalogApi, CommandApi, ReferenceApi } from "@opencode-ai/client/promise"
import type { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
import {
  loadAgentsQuery,
  loadCommands,
  loadPathQuery,
  loadProjectsQuery,
  loadProvidersQuery,
  loadReferencesQuery,
} from "./bootstrap"
import { ServerScope } from "@/utils/server-scope"
import type { ServerApi } from "@/utils/server"

type ProjectApi = ServerApi["project"]
type WorktreeApi = ServerApi["worktree"]

describe("query keys", () => {
  test("partitions identical directories by server scope", () => {
    const api = {} as CatalogApi
    const location = {} as ServerApi["location"]
    const remote = "https://debian.example" as typeof ServerScope.local

    expect([...loadPathQuery(ServerScope.local, "/repo", location).queryKey]).toEqual(["local", "/repo", "path"])
    expect([...loadPathQuery(remote, "/repo", location).queryKey]).toEqual(["https://debian.example", "/repo", "path"])
    expect([...loadProvidersQuery(remote, null, api).queryKey]).toEqual(["https://debian.example", null, "providers"])
  })

  test("loads the current provider and model catalog", async () => {
    const calls: unknown[] = []
    const api = {
      provider: {
        list: async (input: unknown) => {
          calls.push(["provider", input])
          return { location: {}, data: [{ id: "openai", name: "OpenAI", package: "@ai-sdk/openai" }] }
        },
      },
      model: {
        list: async (input: unknown) => {
          calls.push(["model", input])
          return { location: {}, data: [] }
        },
        default: async (input: unknown) => {
          calls.push(["default", input])
          return { location: {}, data: null }
        },
      },
    } as unknown as CatalogApi

    const result = await new QueryClient().fetchQuery(loadProvidersQuery(ServerScope.local, "/repo", api))

    expect(calls).toEqual([
      ["provider", { location: { directory: "/repo" } }],
      ["model", { location: { directory: "/repo" } }],
      ["default", { location: { directory: "/repo" } }],
    ])
    expect(result.connected).toEqual(["openai"])
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

  test("loads agents from the current location-scoped endpoint", async () => {
    const calls: unknown[] = []
    const api = {
      list: async (input: unknown) => {
        calls.push(input)
        return { location: {}, data: [] }
      },
    } as unknown as AgentApi

    const result = await new QueryClient().fetchQuery(loadAgentsQuery(ServerScope.local, "/repo", api))

    expect(calls).toEqual([{ location: { directory: "/repo" } }])
    expect(result).toEqual([])
  })

  test("loads commands from the current location-scoped endpoint", async () => {
    const calls: unknown[] = []
    const api = {
      list: async (input: unknown) => {
        calls.push(input)
        return {
          location: {},
          data: [{ name: "review", template: "Review files" /* source: "command" as const */ }],
        }
      },
    } as unknown as CommandApi

    const result = await loadCommands("/repo", api)

    expect(calls).toEqual([{ location: { directory: "/repo" } }])
    expect(result).toEqual([{ name: "review", template: "Review files" /* source: "command" */ }])
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

  test("loads references from the current location-scoped endpoint", async () => {
    const calls: unknown[] = []
    const api = {
      list: async (input: unknown) => {
        calls.push(input)
        return { location: {}, data: [{ name: "AGENTS.md", path: "/repo/AGENTS.md", source: "instructions" }] }
      },
    } as unknown as ReferenceApi

    const result = await new QueryClient().fetchQuery(loadReferencesQuery(ServerScope.local, "/repo", api))

    expect(calls).toEqual([{ location: { directory: "/repo" } }])
    expect(result).toHaveLength(1)
  })
})
