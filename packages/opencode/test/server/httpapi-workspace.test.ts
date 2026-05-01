import { afterEach, describe, expect, mock } from "bun:test"
import { NodeServices } from "@effect/platform-node"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { registerAdapter } from "../../src/control-plane/adapters"
import type { WorkspaceAdapter } from "../../src/control-plane/types"
import { Workspace } from "../../src/control-plane/workspace"
import { WorkspacePaths } from "../../src/server/routes/instance/httpapi/groups/workspace"
import { Session } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { InstancePaths } from "../../src/server/routes/instance/httpapi/groups/instance"
import { WorkspaceRef } from "../../src/effect/instance-ref"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const originalHttpApi = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const it = testEffect(
  Layer.mergeAll(NodeServices.layer, Project.defaultLayer, Session.defaultLayer, Workspace.defaultLayer),
)

function request(path: string, directory: string, init: RequestInit = {}) {
  return Effect.promise(() => {
    Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
    const headers = new Headers(init.headers)
    headers.set("x-opencode-directory", directory)
    return Promise.resolve(Server.Default().app.request(path, { ...init, headers }))
  })
}

function localAdapter(directory: string): WorkspaceAdapter {
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

function remoteAdapter(directory: string, url: string, headers?: HeadersInit): WorkspaceAdapter {
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
  it.live("serves read endpoints", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })

      const [adapters, workspaces, status] = yield* Effect.all([
        request(WorkspacePaths.adapters, dir),
        request(WorkspacePaths.list, dir),
        request(WorkspacePaths.status, dir),
      ])

      expect(adapters.status).toBe(200)
      expect(yield* Effect.promise(() => adapters.json())).toContainEqual({
        type: "worktree",
        name: "Worktree",
        description: "Create a git worktree",
      })

      expect(workspaces.status).toBe(200)
      expect(yield* Effect.promise(() => workspaces.json())).toEqual([])

      expect(status.status).toBe(200)
      expect(yield* Effect.promise(() => status.json())).toEqual([])
    }),
  )

  it.live("serves mutation endpoints", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
      const dir = yield* tmpdirScoped({ git: true })
      const project = yield* Project.use.fromDirectory(dir)
      registerAdapter(project.project.id, "local-test", localAdapter(path.join(dir, ".workspace")))

      const created = yield* request(WorkspacePaths.list, dir, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "local-test", branch: null, extra: null }),
      })
      expect(created.status).toBe(200)
      const workspace = (yield* Effect.promise(() => created.json())) as Workspace.Info
      expect(workspace).toMatchObject({ type: "local-test", name: "local-test" })

      const session = yield* Session.Service.use((svc) => svc.create({})).pipe(provideInstance(dir))
      const restored = yield* request(WorkspacePaths.sessionRestore.replace(":id", workspace.id), dir, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionID: session.id }),
      })
      expect(restored.status).toBe(200)
      expect((yield* Effect.promise(() => restored.json())) as { total: number }).toMatchObject({
        total: expect.any(Number),
      })

      const removed = yield* request(WorkspacePaths.remove.replace(":id", workspace.id), dir, { method: "DELETE" })
      expect(removed.status).toBe(200)
      expect(yield* Effect.promise(() => removed.json())).toMatchObject({ id: workspace.id })

      const listed = yield* request(WorkspacePaths.list, dir)
      expect(listed.status).toBe(200)
      expect(yield* Effect.promise(() => listed.json())).toEqual([])
    }),
  )

  it.live("routes local workspace requests through the workspace target directory", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
      const dir = yield* tmpdirScoped({ git: true })
      const workspaceDir = path.join(dir, ".workspace-local")
      const project = yield* Project.use.fromDirectory(dir)
      registerAdapter(project.project.id, "local-target", localAdapter(workspaceDir))
      const created = yield* request(WorkspacePaths.list, dir, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "local-target", branch: null, extra: null }),
      })
      const workspace = (yield* Effect.promise(() => created.json())) as Workspace.Info

      const url = new URL(`http://localhost${InstancePaths.path}`)
      url.searchParams.set("workspace", workspace.id)

      const response = yield* request(url.toString(), dir)

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({ directory: workspaceDir })
      yield* request(WorkspacePaths.remove.replace(":id", workspace.id), dir, { method: "DELETE" })
    }),
  )

  it.live("proxies remote workspace HTTP requests with sanitized forwarding", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
      const dir = yield* tmpdirScoped({ git: true })
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

      const project = yield* Project.use.fromDirectory(dir)
      registerAdapter(
        project.project.id,
        "remote-target",
        remoteAdapter(path.join(dir, ".remote"), `http://127.0.0.1:${remote.port}/base`, {
          "x-target-auth": "secret",
        }),
      )
      const created = yield* request(WorkspacePaths.list, dir, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "remote-target", branch: null, extra: null }),
      })
      const workspace = (yield* Effect.promise(() => created.json())) as Workspace.Info

      const url = new URL("http://localhost/config")
      url.searchParams.set("workspace", workspace.id)
      url.searchParams.set("keep", "yes")

      try {
        const response = yield* request(url.toString(), dir, {
          method: "PATCH",
          headers: {
            "accept-encoding": "br",
            "content-type": "application/json",
            "x-opencode-workspace": "internal",
          },
          body: JSON.stringify({ $schema: "https://opencode.ai/config.json" }),
        })

        const responseBody = yield* Effect.promise(() => response.text())
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
        void remote.stop(true)
        yield* request(WorkspacePaths.remove.replace(":id", workspace.id), dir, { method: "DELETE" })
      }
    }),
  )

  it.live("proxies remote workspace requests selected from session ownership", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
      const dir = yield* tmpdirScoped({ git: true })
      const proxied: ProxiedRequest[] = []
      const remote = listenRemoteHttp((request) => {
        proxied.push(request)
        const url = new URL(request.url)
        if (url.pathname === "/base/global/event") return eventStreamResponse()
        if (url.pathname === "/base/sync/history") return Response.json([])
        return Response.json({ proxied: true, path: new URL(request.url).pathname })
      })

      const project = yield* Project.use.fromDirectory(dir)
      registerAdapter(
        project.project.id,
        "remote-session-target",
        remoteAdapter(path.join(dir, ".remote-session"), `http://127.0.0.1:${remote.port}/base`),
      )
      const created = yield* request(WorkspacePaths.list, dir, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "remote-session-target", branch: null, extra: null }),
      })
      const workspace = (yield* Effect.promise(() => created.json())) as Workspace.Info
      const session = yield* Session.Service.use((svc) => svc.create()).pipe(
        Effect.provideService(WorkspaceRef, workspace.id),
        provideInstance(dir),
      )

      try {
        const response = yield* request(`http://localhost/session/${session.id}/message`, dir, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
        })

        const responseBody = yield* Effect.promise(() => response.text())
        expect({ status: response.status, body: responseBody }).toMatchObject({ status: 200 })
        expect(JSON.parse(responseBody)).toEqual({ proxied: true, path: `/base/session/${session.id}/message` })
        expect(proxied.filter((item) => new URL(item.url).pathname === `/base/session/${session.id}/message`)).toEqual([
          expect.objectContaining({
            url: `http://127.0.0.1:${remote.port}/base/session/${session.id}/message`,
            method: "POST",
          }),
        ])
      } finally {
        void remote.stop(true)
        yield* request(WorkspacePaths.remove.replace(":id", workspace.id), dir, { method: "DELETE" })
      }
    }),
  )
})
