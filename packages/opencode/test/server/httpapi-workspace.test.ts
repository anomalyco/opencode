import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
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

void Log.init({ print: false })

const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const originalHttpApi = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI

function request(path: string, directory: string, init: RequestInit = {}) {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  const headers = new Headers(init.headers)
  headers.set("x-opencode-directory", directory)
  return Server.Default().app.request(path, { ...init, headers })
}

function runSession<A, E>(fx: Effect.Effect<A, E, Session.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(Session.defaultLayer)))
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

function remoteAdaptor(directory: string, url: string): WorkspaceAdaptor {
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
      }
    },
  }
}

function eventStreamResponse() {
  return new Response(new ReadableStream({ start() {} }), {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
    },
  })
}

afterEach(async () => {
  mock.restore()
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = originalHttpApi
  await Instance.disposeAll()
  await resetDatabase()
})

describe("workspace HttpApi", () => {
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

  test("proxies remote workspace HTTP requests", async () => {
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
    await using tmp = await tmpdir({ git: true })
    const proxied: string[] = []
    const rawFetch = globalThis.fetch
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: URL | RequestInfo, init?: BunFetchRequestInit | RequestInit) => {
          const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
          if (url.pathname === "/base/global/event") return eventStreamResponse()
          if (url.pathname === "/base/sync/history") return Response.json([])
          proxied.push(url.toString())
          return Response.json({ proxied: true, path: url.pathname, workspace: url.searchParams.get("workspace") })
        },
        {
          preconnect: rawFetch.preconnect?.bind(rawFetch),
        },
      ) as typeof globalThis.fetch,
    )

    const workspace = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        registerAdaptor(
          Instance.project.id,
          "remote-target",
          remoteAdaptor(path.join(tmp.path, ".remote"), "https://remote.test/base"),
        )
        return Workspace.create({
          type: "remote-target",
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
      expect(await response.json()).toEqual({ proxied: true, path: "/base/path", workspace: null })
      expect(proxied).toEqual(["https://remote.test/base/path"])
    } finally {
      await Workspace.remove(workspace.id)
    }
  })
})
