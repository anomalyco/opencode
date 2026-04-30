import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { registerAdaptor } from "../../src/control-plane/adaptors"
import type { WorkspaceAdaptor } from "../../src/control-plane/types"
import { Workspace } from "../../src/control-plane/workspace"
import { WorkspacePaths } from "../../src/server/routes/instance/httpapi/groups/workspace"
import { Session } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { InstancePaths } from "../../src/server/routes/instance/httpapi/groups/instance"
import { WorkspaceRef } from "../../src/effect/instance-ref"

void Log.init({ print: false })

const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const originalHttpApi = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI

function request(path: string, directory: string, init: RequestInit = {}) {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  const headers = new Headers(init.headers)
  headers.set("x-opencode-directory", directory)
  return Server.Default().app.request(path, { ...init, headers })
}

function runSession<A, E>(fx: Effect.Effect<A, E, Session.Service>, workspaceID?: Workspace.Info["id"]) {
  return Effect.runPromise(
    fx.pipe(
      workspaceID ? Effect.provideService(WorkspaceRef, workspaceID) : (effect) => effect,
      Effect.provide(Session.defaultLayer),
    ),
  )
}

function localAdaptor(directory: string): WorkspaceAdaptor {
  return {
    name: "Local Test",
    description: "Create a local test workspace",
    configure(info) {
      return {
        ...info,
        name: "local-test",
        directory,
      }
    },
    async create() {
      await mkdir(directory, { recursive: true })
    },
    async remove() {},
    target() {
      return {
        type: "local" as const,
        directory,
      }
    },
  }
}

function remoteAdaptor(directory: string, url: string, headers?: HeadersInit): WorkspaceAdaptor {
  return {
    name: "Remote Test",
    description: "Create a remote test workspace",
    configure(info) {
      return {
        ...info,
        name: "remote-test",
        directory,
      }
    },
    async create() {
      await mkdir(directory, { recursive: true })
    },
    async remove() {},
    target() {
      return {
        type: "remote" as const,
        url,
        headers,
      }
    },
  }
}

type ProxiedRequest = {
  url: string
  method: string
  headers: Record<string, string>
  body: string
}

function listenRemoteHttp(handler: (request: ProxiedRequest) => Response | Promise<Response>) {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      return handler({
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
        body: await request.text(),
      })
    },
  })
}

function eventStreamResponse() {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"payload":{"type":"server.connected","properties":{}}}\n\n'),
        )
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
    },
  )
}

afterEach(async () => {
  mock.restore()
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = originalHttpApi
  await Instance.disposeAll()
  await resetDatabase()
})

describe("workspace HttpApi", () => {
  test.todo("proxies remote workspace websocket through real Effect listener", () => {})

  test("serves read endpoints", async () => {
    await using tmp = await tmpdir({ git: true })

    const [adaptors, workspaces, status] = await Promise.all([
      request(WorkspacePaths.adaptors, tmp.path),
      request(WorkspacePaths.list, tmp.path),
      request(WorkspacePaths.status, tmp.path),
    ])

    expect(adaptors.status).toBe(200)
    expect(await adaptors.json()).toEqual([
      {
        type: "worktree",
        name: "Worktree",
        description: "Create a git worktree",
      },
    ])

    expect(workspaces.status).toBe(200)
    expect(await workspaces.json()).toEqual([])

    expect(status.status).toBe(200)
    expect(await status.json()).toEqual([])
  })

  test("serves mutation endpoints", async () => {
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        registerAdaptor(Instance.project.id, "local-test", localAdaptor(path.join(tmp.path, ".workspace"))),
    })

    const created = await request(WorkspacePaths.list, tmp.path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "local-test", branch: null, extra: null }),
    })
    expect(created.status).toBe(200)
    const workspace = (await created.json()) as Workspace.Info
    expect(workspace).toMatchObject({ type: "local-test", name: "local-test" })

    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () => runSession(Session.Service.use((svc) => svc.create({}))),
    })
    const restored = await request(WorkspacePaths.sessionRestore.replace(":id", workspace.id), tmp.path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionID: session.id }),
    })
    expect(restored.status).toBe(200)
    expect((await restored.json()) as { total: number }).toMatchObject({ total: expect.any(Number) })

    const removed = await request(WorkspacePaths.remove.replace(":id", workspace.id), tmp.path, { method: "DELETE" })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toMatchObject({ id: workspace.id })

    const listed = await request(WorkspacePaths.list, tmp.path)
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual([])
  })

  test("routes local workspace requests through the workspace target directory", async () => {
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
    await using tmp = await tmpdir({ git: true })
    const workspaceDir = path.join(tmp.path, ".workspace-local")
    const workspace = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        registerAdaptor(Instance.project.id, "local-target", localAdaptor(workspaceDir))
        return Workspace.create({
          type: "local-target",
          branch: null,
          extra: null,
          projectID: Instance.project.id,
        })
      },
    })

    const url = new URL(`http://localhost${InstancePaths.path}`)
    url.searchParams.set("workspace", workspace.id)

    try {
      const response = await request(url.toString(), tmp.path)

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ directory: workspaceDir })
    } finally {
      await Workspace.remove(workspace.id)
    }
  })

  test("proxies remote workspace HTTP requests with sanitized forwarding", async () => {
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
    await using tmp = await tmpdir({ git: true })
    const proxied: ProxiedRequest[] = []
    const remote = listenRemoteHttp((request) => {
      proxied.push(request)
      const url = new URL(request.url)
      if (url.pathname === "/base/global/event") return eventStreamResponse()
      if (url.pathname === "/base/sync/history") return Response.json([])
      return new Response(
        JSON.stringify({
          proxied: true,
          path: url.pathname,
          keep: url.searchParams.get("keep"),
          workspace: url.searchParams.get("workspace"),
        }),
        {
          status: 201,
          statusText: "Created",
          headers: {
            "content-length": "999",
            "content-type": "application/json",
            "x-remote": "yes",
          },
        },
      )
    })

    const workspace = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        registerAdaptor(
          Instance.project.id,
          "remote-target",
          remoteAdaptor(path.join(tmp.path, ".remote"), `http://127.0.0.1:${remote.port}/base`, {
            "x-target-auth": "secret",
          }),
        )
        return Workspace.create({
          type: "remote-target",
          branch: null,
          extra: null,
          projectID: Instance.project.id,
        })
      },
    })

    const url = new URL("http://localhost/config")
    url.searchParams.set("workspace", workspace.id)
    url.searchParams.set("keep", "yes")

    try {
      const response = await request(url.toString(), tmp.path, {
        method: "PATCH",
        headers: {
          "accept-encoding": "br",
          "content-type": "application/json",
          "x-opencode-workspace": "internal",
        },
        body: JSON.stringify({ $schema: "https://opencode.ai/config.json" }),
      })

      const responseBody = await response.text()
      expect({ status: response.status, body: responseBody }).toMatchObject({ status: 201 })
      expect(response.headers.get("content-length")).toBeNull()
      expect(response.headers.get("x-remote")).toBe("yes")
      expect(JSON.parse(responseBody)).toEqual({ proxied: true, path: "/base/config", keep: "yes", workspace: null })
      const forwarded = proxied.filter((item) => new URL(item.url).pathname === "/base/config")
      expect(forwarded).toEqual([
        {
          url: `http://127.0.0.1:${remote.port}/base/config?keep=yes`,
          method: "PATCH",
          headers: expect.objectContaining({
            "content-type": "application/json",
            "x-target-auth": "secret",
          }),
          body: JSON.stringify({ $schema: "https://opencode.ai/config.json" }),
        },
      ])
      expect(forwarded[0]?.headers).not.toHaveProperty("x-opencode-directory")
      expect(forwarded[0]?.headers).not.toHaveProperty("x-opencode-workspace")
    } finally {
      remote.stop(true)
      await Workspace.remove(workspace.id)
    }
  })

  test("proxies remote workspace requests selected from session ownership", async () => {
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
    await using tmp = await tmpdir({ git: true })
    const proxied: ProxiedRequest[] = []
    const remote = listenRemoteHttp((request) => {
      proxied.push(request)
      const url = new URL(request.url)
      if (url.pathname === "/base/global/event") return eventStreamResponse()
      if (url.pathname === "/base/sync/history") return Response.json([])
      return Response.json({ proxied: true, path: new URL(request.url).pathname })
    })

    const workspace = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        registerAdaptor(
          Instance.project.id,
          "remote-session-target",
          remoteAdaptor(path.join(tmp.path, ".remote-session"), `http://127.0.0.1:${remote.port}/base`),
        )
        return Workspace.create({
          type: "remote-session-target",
          branch: null,
          extra: null,
          projectID: Instance.project.id,
        })
      },
    })
    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        runSession(
          Session.Service.use((svc) => svc.create()),
          workspace.id,
        ),
    })

    try {
      const response = await request(`http://localhost/session/${session.id}/message`, tmp.path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
      })

      const responseBody = await response.text()
      expect({ status: response.status, body: responseBody }).toMatchObject({ status: 200 })
      expect(JSON.parse(responseBody)).toEqual({ proxied: true, path: `/base/session/${session.id}/message` })
      expect(proxied.filter((item) => new URL(item.url).pathname === `/base/session/${session.id}/message`)).toEqual([
        expect.objectContaining({
          url: `http://127.0.0.1:${remote.port}/base/session/${session.id}/message`,
          method: "POST",
        }),
      ])
    } finally {
      remote.stop(true)
      await Workspace.remove(workspace.id)
    }
  })
})
