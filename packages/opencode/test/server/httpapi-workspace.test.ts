import { afterEach, describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { registerAdaptor } from "../../src/control-plane/adaptors"
import type { WorkspaceAdaptor } from "../../src/control-plane/types"
import { Workspace } from "../../src/control-plane/workspace"
import { WorkspacePaths } from "../../src/server/routes/instance/httpapi/workspace"
import { Session } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"

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

afterEach(async () => {
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
})
