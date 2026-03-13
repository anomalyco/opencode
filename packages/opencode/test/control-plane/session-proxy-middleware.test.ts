import { afterEach, describe, expect, mock, test } from "bun:test"
import { WorkspaceID } from "../../src/control-plane/schema"
import { Hono } from "hono"
import { tmpdir } from "../fixture/fixture"
import { Project } from "../../src/project/project"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { Instance } from "../../src/project/instance"
import { WorkspaceContext } from "../../src/control-plane/workspace-context"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import * as adaptors from "../../src/control-plane/adaptors"
import type { Adaptor } from "../../src/control-plane/types"
import { Flag } from "../../src/flag/flag"

afterEach(async () => {
  mock.restore()
  await resetDatabase()
})

const original = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
// @ts-expect-error don't do this normally, but it works
Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true

afterEach(() => {
  // @ts-expect-error don't do this normally, but it works
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = original
})

type State = {
  workspace?: "first" | "second"
  calls: Array<{ method: string; url: string; body?: string }>
}

const remote = { type: "testing", name: "remote-a" } as unknown as typeof WorkspaceTable.$inferInsert

async function setup(state: State) {
  const TestAdaptor: Adaptor = {
    configure(config) {
      return config
    },
    async create() {
      throw new Error("not used")
    },
    async remove() {},

    async fetch(_config: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const url =
        input instanceof Request || input instanceof URL
          ? input.toString()
          : new URL(input, "http://workspace.test").toString()
      const request = new Request(url, init)
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text()
      state.calls.push({
        method: request.method,
        url: `${new URL(request.url).pathname}${new URL(request.url).search}`,
        body,
      })
      return new Response("proxied", { status: 202 })
    },
  }

  adaptors.installAdaptor("testing", TestAdaptor)

  await using tmp = await tmpdir({ git: true })
  const { project } = await Project.fromDirectory(tmp.path)

  const id1 = WorkspaceID.ascending()
  const id2 = WorkspaceID.ascending()

  Database.use((db) =>
    db
      .insert(WorkspaceTable)
      .values([
        {
          id: id1,
          branch: "main",
          project_id: project.id,
          type: remote.type,
          name: remote.name,
        },
        {
          id: id2,
          branch: "main",
          project_id: project.id,
          type: "worktree",
          directory: tmp.path,
          name: "local",
        },
      ])
      .run(),
  )

  const { WorkspaceRouterMiddleware } = await import("../../src/control-plane/workspace-router-middleware")
  const app = new Hono().use(WorkspaceRouterMiddleware)

  return {
    id1,
    id2,
    app,
    async request(input: RequestInfo | URL, init?: RequestInit) {
      return Instance.provide({
        directory: tmp.path,
        fn: async () =>
          WorkspaceContext.provide({
            workspaceID: state.workspace === "first" ? id1 : id2,
            fn: () => app.request(input, init),
          }),
      })
    },
  }
}

describe("control-plane/session-proxy-middleware", () => {
  test("forwards non-GET session requests for workspaces", async () => {
    const state: State = {
      workspace: "first",
      calls: [],
    }

    const ctx = await setup(state)

    ctx.app.post("/session/foo", (c) => c.text("local", 200))
    const response = await ctx.request("http://workspace.test/session/foo?x=1", {
      method: "POST",
      body: JSON.stringify({ hello: "world" }),
      headers: {
        "content-type": "application/json",
      },
    })

    expect(response.status).toBe(202)
    expect(await response.text()).toBe("proxied")
    expect(state.calls).toEqual([
      {
        method: "POST",
        url: "/session/foo?x=1",
        body: '{"hello":"world"}',
      },
    ])
  })

  // It will behave this way when we have syncing
  //
  // test("does not forward GET requests", async () => {
  //   const state: State = {
  //     workspace: "first",
  //     calls: [],
  //   }

  //   const ctx = await setup(state)

  //   ctx.app.get("/session/foo", (c) => c.text("local", 200))
  //   const response = await ctx.request("http://workspace.test/session/foo?x=1")

  //   expect(response.status).toBe(200)
  //   expect(await response.text()).toBe("local")
  //   expect(state.calls).toEqual([])
  // })
})
