import { describe, expect, test } from "bun:test"
import { OpenCode } from "@opencode-ai/client/promise"
import { createData } from "@opencode-ai/client/solid"
import { createRoot } from "solid-js"
import { createWorktree } from "./create"

describe("worktree creation", () => {
  test.each(
    [
      { name: "clone", directory: "/copies/repo", root: "/copies/repo", canonical: "/copies/repo", parent: "/copies/" },
      {
        name: "clone subdirectory",
        directory: "/copies/repo/packages/app",
        root: "/copies/repo",
        canonical: "/copies/repo",
        parent: "/copies/",
      },
      {
        name: "linked worktree subdirectory",
        directory: "/linked/task/packages/app",
        root: "/linked/task",
        canonical: "/copies/repo",
        parent: "/copies/",
      },
      {
        name: "Windows clone",
        directory: "C:\\copies\\repo\\packages\\app",
        root: "C:\\copies\\repo",
        canonical: "C:\\copies\\repo",
        parent: "C:/copies/",
      },
    ].flatMap((input) => [true, false].map((cached) => ({ ...input, cached }))),
  )("uses the clone-local main for $name (cached: $cached)", async (input) => {
    const project = { id: "proj_clone", directory: input.root, canonical: input.canonical }
    const requests: Request[] = []
    const api = OpenCode.make({
      baseUrl: "http://localhost:3000",
      fetch: Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init)
          requests.push(request)
          if (request.method === "POST") return Response.json({ directory: "/created" })
          return Response.json({ directory: new URL(request.url).searchParams.get("location[directory]"), project })
        },
        { preconnect() {} },
      ),
    })

    await createRoot(async (dispose) => {
      const data = createData({
        api: () => api,
        directory: input.directory,
        event: { on: () => () => {}, listen: () => () => {} },
      })
      try {
        expect(
          await createWorktree({
            api,
            data,
            directory: input.directory,
            project: input.cached ? project : undefined,
            branch: "clone-only",
          }),
        ).toBe("/created")
        expect(await requests.find((request) => request.method === "POST")?.json()).toEqual({
          strategy: "git",
          from: input.canonical,
          branch: "clone-only",
          directory: input.parent,
        })
        expect(requests.find((request) => request.method === "POST")?.url).toBe(
          "http://localhost:3000/api/worktree/proj_clone",
        )
        expect(
          requests
            .filter((request) => request.method === "GET")
            .map((request) => new URL(request.url).searchParams.get("location[directory]")),
        ).toEqual(input.cached ? ["/created"] : [input.directory, "/created"])
        expect(data.location.info({ directory: "/created" })).toEqual({ directory: "/created", project })
        const count = requests.length
        await data.location.syncInfo({ directory: "/created" })
        expect(requests).toHaveLength(count)
      } finally {
        dispose()
      }
    })
  })

  test("does not fall back to a shared project when location lookup fails", async () => {
    const requests: Request[] = []
    const api = OpenCode.make({
      baseUrl: "http://localhost:3000",
      fetch: Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          requests.push(new Request(input, init))
          return Response.json({ message: "unavailable" }, { status: 503 })
        },
        { preconnect() {} },
      ),
    })

    await createRoot(async (dispose) => {
      const data = createData({
        api: () => api,
        directory: "/copies/repo",
        event: { on: () => () => {}, listen: () => () => {} },
      })
      try {
        await expect(createWorktree({ api, data, directory: "/copies/repo" })).rejects.toMatchObject({
          reason: "UnexpectedStatus",
          cause: { status: 503 },
        })
        expect(requests.map((request) => request.method)).toEqual(["GET"])
      } finally {
        dispose()
      }
    })
  })
})
