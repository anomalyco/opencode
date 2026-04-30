import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import Http from "node:http"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { asc, eq } from "drizzle-orm"
import * as Log from "@opencode-ai/core/util/log"
import { Flag } from "@opencode-ai/core/flag/flag"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { Database } from "@/storage/db"
import { ProjectID } from "@/project/schema"
import { ProjectTable } from "@/project/project.sql"
import { Instance } from "@/project/instance"
import { Session as SessionNs } from "@/session/session"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { SessionTable } from "@/session/session.sql"
import { ModelID, ProviderID } from "@/provider/schema"
import { SyncEvent } from "@/sync"
import { EventSequenceTable, EventTable } from "@/sync/event.sql"
import { resetDatabase } from "../fixture/db"
import { provideTmpdirInstance, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { registerAdaptor } from "../../src/control-plane/adaptors"
import { WorkspaceID } from "../../src/control-plane/schema"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import type { Target, WorkspaceAdaptor, WorkspaceInfo } from "../../src/control-plane/types"
import * as WorkspaceOld from "../../src/control-plane/workspace"
import { AppRuntime } from "@/effect/app-runtime"

void Log.init({ print: false })

const testServerLayer = Layer.mergeAll(
  NodeHttpServer.layer(Http.createServer, { host: "127.0.0.1", port: 0 }),
  WorkspaceOld.defaultLayer,
  SessionNs.defaultLayer,
)
const it = testEffect(testServerLayer)

const originalWorkspacesFlag = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const originalEnv = {
  OPENCODE_AUTH_CONTENT: process.env.OPENCODE_AUTH_CONTENT,
  OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS,
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  OTEL_RESOURCE_ATTRIBUTES: process.env.OTEL_RESOURCE_ATTRIBUTES,
}

type RecordedCreate = {
  info: WorkspaceInfo
  env: Record<string, string | undefined>
  from?: WorkspaceInfo
}

type RecordedAdaptor = {
  adaptor: WorkspaceAdaptor
  calls: {
    configure: WorkspaceInfo[]
    create: RecordedCreate[]
    remove: WorkspaceInfo[]
    target: WorkspaceInfo[]
  }
}

type FetchCall = {
  url: URL
  method: string
  headers: Headers
  bodyText?: string
  json?: unknown
}

function unique(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2)}`
}

function restoreEnv() {
  Object.entries(originalEnv).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key]
      return
    }
    process.env[key] = value
  })
}

beforeEach(() => {
  Database.close()
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
  restoreEnv()
})

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspacesFlag
  restoreEnv()
  await resetDatabase()
})

async function withInstance<T>(fn: (dir: string) => T | Promise<T>) {
  await using tmp = await tmpdir({ git: true })
  return Instance.provide({
    directory: tmp.path,
    fn: () => fn(tmp.path),
  })
}

function captureGlobalEvents() {
  const events: GlobalEvent[] = []
  const handler = (event: GlobalEvent) => events.push(event)
  GlobalBus.on("event", handler)
  return {
    events,
    dispose() {
      GlobalBus.off("event", handler)
    },
  }
}

async function eventually<T>(fn: () => T | Promise<T>, timeout = 1500) {
  const started = Date.now()
  let last: unknown
  while (Date.now() - started < timeout) {
    try {
      return await fn()
    } catch (err) {
      last = err
      await delay(10)
    }
  }
  throw last ?? new Error("Timed out waiting for condition")
}

function eventuallyEffect(effect: Effect.Effect<void>, timeout = 1500) {
  return Effect.gen(function* () {
    const started = Date.now()
    let last: unknown
    while (Date.now() - started < timeout) {
      const exit = yield* Effect.exit(effect)
      if (exit._tag === "Success") return
      last = exit.cause
      yield* Effect.sleep("10 millis")
    }
    throw last ?? new Error("Timed out waiting for condition")
  })
}

function recordedAdaptor(input: {
  target: (info: WorkspaceInfo) => Target | Promise<Target>
  configure?: (info: WorkspaceInfo) => WorkspaceInfo | Promise<WorkspaceInfo>
  create?: (info: WorkspaceInfo, env: Record<string, string | undefined>, from?: WorkspaceInfo) => Promise<void>
  remove?: (info: WorkspaceInfo) => Promise<void>
}): RecordedAdaptor {
  const calls: RecordedAdaptor["calls"] = {
    configure: [],
    create: [],
    remove: [],
    target: [],
  }

  return {
    calls,
    adaptor: {
      name: "recorded",
      description: "recorded",
      configure(info) {
        calls.configure.push(structuredClone(info))
        return input.configure?.(info) ?? info
      },
      async create(info, env, from) {
        calls.create.push({
          info: structuredClone(info),
          env: { ...env },
          from: from ? structuredClone(from) : undefined,
        })
        await input.create?.(info, env, from)
      },
      async remove(info) {
        calls.remove.push(structuredClone(info))
        await input.remove?.(info)
      },
      target(info) {
        calls.target.push(structuredClone(info))
        return input.target(info)
      },
    },
  }
}

function localAdaptor(dir: string, input?: { createDir?: boolean; remove?: (info: WorkspaceInfo) => Promise<void> }) {
  return recordedAdaptor({
    configure(info) {
      return { ...info, directory: dir }
    },
    async create() {
      if (input?.createDir === false) return
      await fs.mkdir(dir, { recursive: true })
    },
    remove: input?.remove,
    target() {
      return { type: "local", directory: dir }
    },
  })
}

function remoteAdaptor(url: string, input?: { directory?: string | null; headers?: HeadersInit }) {
  return recordedAdaptor({
    configure(info) {
      return { ...info, directory: input?.directory ?? info.directory }
    },
    target() {
      return { type: "remote", url, headers: input?.headers }
    },
  })
}

function eventStreamResponse(events: unknown[] = [], keepOpen = true) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        if (keepOpen) controller.enqueue(encoder.encode(":\n\n"))
        events.forEach((event) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)))
        if (!keepOpen) controller.close()
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  )
}

function serverUrl() {
  return Effect.gen(function* () {
    return HttpServer.formatAddress((yield* HttpServer.HttpServer).address)
  })
}

function workspaceInfo(projectID: ProjectID, type: string, input?: Partial<WorkspaceInfo>): WorkspaceInfo {
  return {
    id: input?.id ?? WorkspaceID.ascending(),
    type,
    name: input?.name ?? unique("workspace"),
    branch: input?.branch ?? null,
    directory: input?.directory ?? null,
    extra: input?.extra ?? null,
    projectID,
  }
}

function insertWorkspace(info: WorkspaceInfo) {
  Database.use((db) =>
    db
      .insert(WorkspaceTable)
      .values({
        id: info.id,
        type: info.type,
        branch: info.branch,
        name: info.name,
        directory: info.directory,
        extra: info.extra,
        project_id: info.projectID,
      })
      .run(),
  )
}

function insertProject(id: ProjectID, worktree: string) {
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id,
        worktree,
        vcs: null,
        name: null,
        time_created: Date.now(),
        time_updated: Date.now(),
        sandboxes: [],
      })
      .run(),
  )
}

function attachSessionToWorkspace(sessionID: SessionID, workspaceID: WorkspaceID) {
  Database.use((db) =>
    db.update(SessionTable).set({ workspace_id: workspaceID }).where(eq(SessionTable.id, sessionID)).run(),
  )
}

function sessionSequence(sessionID: SessionID) {
  return Database.use((db) =>
    db
      .select({ seq: EventSequenceTable.seq })
      .from(EventSequenceTable)
      .where(eq(EventSequenceTable.aggregate_id, sessionID))
      .get(),
  )?.seq
}

function eventRows(sessionID: SessionID) {
  return Database.use((db) =>
    db
      .select({ seq: EventTable.seq, type: EventTable.type, data: EventTable.data })
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, sessionID))
      .orderBy(asc(EventTable.seq))
      .all(),
  )
}

function sessionUpdatedType() {
  return SyncEvent.versionedType(SessionNs.Event.Updated.type, SessionNs.Event.Updated.version)
}

function replaceSessionEvents(sessionID: SessionID, count: number) {
  Database.use((db) => {
    db.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, sessionID)).run()
    if (count === 0) return

    db.insert(EventSequenceTable)
      .values({ aggregate_id: sessionID, seq: count - 1 })
      .run()
    db.insert(EventTable)
      .values(
        Array.from({ length: count }, (_, i) => ({
          id: `evt_${unique(`manual-${i}`)}`,
          aggregate_id: sessionID,
          seq: i,
          type: sessionUpdatedType(),
          data: { sessionID, info: { title: `manual ${i}` } },
        })),
      )
      .run()
  })
}

describe("workspace-old schemas and exports", () => {
  test("keeps the historical event type names", () => {
    expect(WorkspaceOld.Event.Ready.type).toBe("workspace.ready")
    expect(WorkspaceOld.Event.Failed.type).toBe("workspace.failed")
    expect(WorkspaceOld.Event.Restore.type).toBe("workspace.restore")
    expect(WorkspaceOld.Event.Status.type).toBe("workspace.status")
  })

  test("validates create input with workspace id, project id, branch, type, and extra", () => {
    const input = {
      id: WorkspaceID.ascending("wrk_schema_create"),
      type: "worktree",
      branch: "feature/schema",
      projectID: ProjectID.make("project-schema"),
      extra: { nested: true },
    }

    expect(WorkspaceOld.CreateInput.zod.parse(input)).toEqual(input)
    expect(() => WorkspaceOld.CreateInput.zod.parse({ ...input, id: "bad" })).toThrow()
    expect(() => WorkspaceOld.CreateInput.zod.parse({ ...input, branch: 1 })).toThrow()
  })

  test("validates session restore input", () => {
    const input = {
      workspaceID: WorkspaceID.ascending("wrk_schema_restore"),
      sessionID: SessionID.descending("ses_schema_restore"),
    }

    expect(WorkspaceOld.SessionRestoreInput.zod.parse(input)).toEqual(input)
    expect(() => WorkspaceOld.SessionRestoreInput.zod.parse({ ...input, workspaceID: "bad" })).toThrow()
    expect(() => WorkspaceOld.SessionRestoreInput.zod.parse({ ...input, sessionID: "bad" })).toThrow()
  })
})

describe("workspace-old CRUD", () => {
  test("get returns undefined for a missing workspace", async () => {
    await withInstance(async () => {
      expect(await WorkspaceOld.get(WorkspaceID.ascending("wrk_missing_get"))).toBeUndefined()
    })
  })

  test("list maps database rows, filters by project, and sorts by id", async () => {
    await withInstance(() => {
      const otherProjectID = ProjectID.make("project-other")
      insertProject(otherProjectID, "/tmp/other")
      const a = workspaceInfo(Instance.project.id, "manual", {
        id: WorkspaceID.ascending("wrk_a_list"),
        branch: "a",
        directory: "/a",
        extra: { a: true },
      })
      const b = workspaceInfo(Instance.project.id, "manual", {
        id: WorkspaceID.ascending("wrk_b_list"),
        branch: "b",
        directory: "/b",
        extra: ["b"],
      })
      const other = workspaceInfo(otherProjectID, "manual", { id: WorkspaceID.ascending("wrk_c_list") })
      insertWorkspace(b)
      insertWorkspace(other)
      insertWorkspace(a)

      expect(WorkspaceOld.list(Instance.project)).toEqual([a, b])
    })
  })

  test("create configures, persists, creates, starts local sync, and passes environment", async () => {
    await withInstance(async (dir) => {
      process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ test: { type: "api", key: "secret" } })
      process.env.OTEL_EXPORTER_OTLP_HEADERS = "authorization=otel"
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otel.test"
      process.env.OTEL_RESOURCE_ATTRIBUTES = "service.name=opencode-test"

      const workspaceID = WorkspaceID.ascending("wrk_create_local")
      const type = unique("create-local")
      const targetDir = path.join(dir, "created-local")
      const recorded = recordedAdaptor({
        configure(info) {
          return {
            ...info,
            branch: "configured-branch",
            name: "Configured Name",
            directory: targetDir,
            extra: { configured: true },
          }
        },
        async create() {
          await fs.mkdir(targetDir, { recursive: true })
        },
        target() {
          return { type: "local", directory: targetDir }
        },
      })
      registerAdaptor(Instance.project.id, type, recorded.adaptor)

      const info = await WorkspaceOld.create({
        id: workspaceID,
        type,
        branch: null,
        projectID: Instance.project.id,
        extra: null,
      })

      expect(info).toEqual({
        id: workspaceID,
        type,
        branch: "configured-branch",
        name: "Configured Name",
        directory: targetDir,
        extra: { configured: true },
        projectID: Instance.project.id,
      })
      expect(await WorkspaceOld.get(workspaceID)).toEqual(info)
      expect(WorkspaceOld.list(Instance.project)).toEqual([info])
      expect(recorded.calls.configure).toHaveLength(1)
      expect(recorded.calls.configure[0]).toMatchObject({ id: workspaceID, type, directory: null })
      expect(recorded.calls.create).toHaveLength(1)
      expect(recorded.calls.create[0].info).toEqual(info)
      expect(JSON.parse(recorded.calls.create[0].env.OPENCODE_AUTH_CONTENT ?? "{}")).toEqual({
        test: { type: "api", key: "secret" },
      })
      expect(recorded.calls.create[0].env.OPENCODE_WORKSPACE_ID).toBe(workspaceID)
      expect(recorded.calls.create[0].env.OPENCODE_EXPERIMENTAL_WORKSPACES).toBe("true")
      expect(recorded.calls.create[0].env.OTEL_EXPORTER_OTLP_HEADERS).toBe("authorization=otel")
      expect(recorded.calls.create[0].env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("https://otel.test")
      expect(recorded.calls.create[0].env.OTEL_RESOURCE_ATTRIBUTES).toBe("service.name=opencode-test")
      expect(WorkspaceOld.status().find((item) => item.workspaceID === workspaceID)?.status).toBe("connected")

      await WorkspaceOld.remove(workspaceID)
      expect(WorkspaceOld.status().find((item) => item.workspaceID === workspaceID)?.status).toBeUndefined()
    })
  })

  test("create propagates configure failures and does not insert a workspace", async () => {
    await withInstance(async () => {
      const type = unique("configure-failure")
      registerAdaptor(
        Instance.project.id,
        type,
        recordedAdaptor({
          configure() {
            throw new Error("configure exploded")
          },
          target() {
            return { type: "local", directory: "/unused" }
          },
        }).adaptor,
      )

      await expect(
        WorkspaceOld.create({ type, branch: null, projectID: Instance.project.id, extra: null }),
      ).rejects.toThrow("configure exploded")
      expect(WorkspaceOld.list(Instance.project)).toEqual([])
    })
  })

  test("create leaves the inserted row when adaptor create fails", async () => {
    await withInstance(async () => {
      const type = unique("create-failure")
      const recorded = recordedAdaptor({
        async create() {
          throw new Error("create exploded")
        },
        target() {
          return { type: "local", directory: "/unused" }
        },
      })
      registerAdaptor(Instance.project.id, type, recorded.adaptor)

      await expect(
        WorkspaceOld.create({ type, branch: "branch", projectID: Instance.project.id, extra: { x: 1 } }),
      ).rejects.toThrow("create exploded")

      const rows = WorkspaceOld.list(Instance.project)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ type, branch: "branch", extra: { x: 1 } })
      expect(recorded.calls.target).toHaveLength(0)
      await WorkspaceOld.remove(rows[0].id)
    })
  })

  test("create returns after a local workspace reports error", async () => {
    await withInstance(async (dir) => {
      const type = unique("local-error")
      const missing = path.join(dir, "missing-local-target")
      const recorded = localAdaptor(missing, { createDir: false })
      registerAdaptor(Instance.project.id, type, recorded.adaptor)

      const info = await WorkspaceOld.create({ type, branch: null, projectID: Instance.project.id, extra: null })

      expect(info.directory).toBe(missing)
      expect(WorkspaceOld.status().find((item) => item.workspaceID === info.id)?.status).toBe("error")
      await WorkspaceOld.remove(info.id)
    })
  })

  it.live("remote create connects to routed event and history endpoints", () => {
    const calls: FetchCall[] = []
    return Effect.gen(function* () {
      yield* HttpServer.serveEffect()(
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          const bodyText = yield* req.text
          const call = {
            url: new URL(req.url, "http://localhost"),
            method: req.method,
            headers: new Headers(req.headers),
            bodyText,
            json: bodyText ? JSON.parse(bodyText) : undefined,
          }
          calls.push(call)
          if (call.url.pathname === "/base/global/event")
            return HttpServerResponse.fromWeb(eventStreamResponse([], false))
          if (call.url.pathname === "/base/sync/history") return yield* HttpServerResponse.json([])
          return HttpServerResponse.text("unexpected", { status: 500 })
        }),
      )
      const url = yield* serverUrl()
      yield* provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const workspace = yield* WorkspaceOld.Service
            const type = unique("remote-create")
            const recorded = remoteAdaptor(`${url}/base/?ignored=1#hash`, { directory: dir })
            registerAdaptor(Instance.project.id, type, recorded.adaptor)

            const info = yield* workspace.create({ type, branch: null, projectID: Instance.project.id, extra: null })

            expect(
              calls.map((call) => `${call.method} ${call.url.pathname}${call.url.search}${call.url.hash}`),
            ).toEqual(["GET /base/global/event", "POST /base/sync/history"])
            expect(calls[1].json).toEqual({})
            expect((yield* workspace.status()).find((item) => item.workspaceID === info.id)?.status).toBe("connected")
            expect(yield* workspace.isSyncing(info.id)).toBe(true)

            yield* workspace.remove(info.id)
            expect(yield* workspace.isSyncing(info.id)).toBe(false)
            expect((yield* workspace.status()).find((item) => item.workspaceID === info.id)?.status).toBeUndefined()
          }),
        { git: true },
      )
    })
  })

  test("remove returns undefined for a missing workspace", async () => {
    await withInstance(async () => {
      expect(await WorkspaceOld.remove(WorkspaceID.ascending("wrk_missing_remove"))).toBeUndefined()
    })
  })

  test("remove deletes the workspace, associated sessions, adaptor resources, and status", async () => {
    await withInstance(async (dir) => {
      const type = unique("remove-local")
      const recorded = localAdaptor(path.join(dir, "remove-local"))
      registerAdaptor(Instance.project.id, type, recorded.adaptor)
      const info = await WorkspaceOld.create({ type, branch: null, projectID: Instance.project.id, extra: null })
      const one = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({})))
      const two = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({})))
      attachSessionToWorkspace(one.id, info.id)
      attachSessionToWorkspace(two.id, info.id)

      const removed = await WorkspaceOld.remove(info.id)

      expect(removed).toEqual(info)
      expect(await WorkspaceOld.get(info.id)).toBeUndefined()
      expect(recorded.calls.remove).toEqual([info])
      expect(WorkspaceOld.status().find((item) => item.workspaceID === info.id)?.status).toBeUndefined()
      expect(
        Database.use((db) =>
          db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.workspace_id, info.id)).all(),
        ),
      ).toEqual([])
    })
  })

  test("remove still deletes the row when the adaptor cannot remove resources", async () => {
    await withInstance(async () => {
      const type = unique("remove-throws")
      const info = workspaceInfo(Instance.project.id, type, { id: WorkspaceID.ascending("wrk_remove_throws") })
      registerAdaptor(
        Instance.project.id,
        type,
        recordedAdaptor({
          async remove() {
            throw new Error("remove exploded")
          },
          target() {
            return { type: "local", directory: "/unused" }
          },
        }).adaptor,
      )
      insertWorkspace(info)

      expect(await WorkspaceOld.remove(info.id)).toEqual(info)
      expect(await WorkspaceOld.get(info.id)).toBeUndefined()
    })
  })
})

describe("workspace-old sync state", () => {
  test("startWorkspaceSyncing is disabled by the experimental workspace flag", async () => {
    await withInstance(async (dir) => {
      Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = false
      const type = unique("flag-disabled")
      const info = workspaceInfo(Instance.project.id, type)
      const session = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({})))
      attachSessionToWorkspace(session.id, info.id)
      insertWorkspace(info)
      registerAdaptor(Instance.project.id, type, localAdaptor(path.join(dir, "flag-disabled")).adaptor)

      WorkspaceOld.startWorkspaceSyncing(Instance.project.id)
      await delay(25)

      expect(WorkspaceOld.status().find((item) => item.workspaceID === info.id)?.status).toBeUndefined()
    })
  })

  test("startWorkspaceSyncing starts only workspaces with sessions", async () => {
    await withInstance(async (dir) => {
      const withSessionType = unique("with-session")
      const withoutSessionType = unique("without-session")
      const withSession = workspaceInfo(Instance.project.id, withSessionType)
      const withoutSession = workspaceInfo(Instance.project.id, withoutSessionType)
      const withSessionDir = path.join(dir, "with-session")
      const withoutSessionDir = path.join(dir, "without-session")
      await fs.mkdir(withSessionDir, { recursive: true })
      await fs.mkdir(withoutSessionDir, { recursive: true })
      insertWorkspace(withSession)
      insertWorkspace(withoutSession)
      registerAdaptor(Instance.project.id, withSessionType, localAdaptor(withSessionDir).adaptor)
      registerAdaptor(Instance.project.id, withoutSessionType, localAdaptor(withoutSessionDir).adaptor)
      attachSessionToWorkspace(
        (await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({})))).id,
        withSession.id,
      )

      WorkspaceOld.startWorkspaceSyncing(Instance.project.id)

      await eventually(() =>
        expect(WorkspaceOld.status().find((item) => item.workspaceID === withSession.id)?.status).toBe("connected"),
      )
      expect(WorkspaceOld.status().find((item) => item.workspaceID === withoutSession.id)?.status).toBeUndefined()
      await WorkspaceOld.remove(withSession.id)
      await WorkspaceOld.remove(withoutSession.id)
    })
  })

  test("local start reports error when the target directory is missing", async () => {
    await withInstance(async (dir) => {
      const type = unique("missing-local")
      const info = workspaceInfo(Instance.project.id, type)
      insertWorkspace(info)
      registerAdaptor(
        Instance.project.id,
        type,
        localAdaptor(path.join(dir, "missing-target"), { createDir: false }).adaptor,
      )
      attachSessionToWorkspace(
        (await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({})))).id,
        info.id,
      )

      WorkspaceOld.startWorkspaceSyncing(Instance.project.id)

      await eventually(() =>
        expect(WorkspaceOld.status().find((item) => item.workspaceID === info.id)?.status).toBe("error"),
      )
      expect(await WorkspaceOld.isSyncing(info.id)).toBe(false)
      await WorkspaceOld.remove(info.id)
    })
  })

  test("duplicate local status updates are suppressed", async () => {
    await withInstance(async (dir) => {
      const captured = captureGlobalEvents()
      try {
        const type = unique("dedupe-local")
        const info = workspaceInfo(Instance.project.id, type)
        const target = path.join(dir, "dedupe-local")
        await fs.mkdir(target, { recursive: true })
        insertWorkspace(info)
        registerAdaptor(Instance.project.id, type, localAdaptor(target).adaptor)
        attachSessionToWorkspace(
          (await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({})))).id,
          info.id,
        )

        WorkspaceOld.startWorkspaceSyncing(Instance.project.id)
        WorkspaceOld.startWorkspaceSyncing(Instance.project.id)

        await eventually(() =>
          expect(WorkspaceOld.status().find((item) => item.workspaceID === info.id)?.status).toBe("connected"),
        )
        expect(
          captured.events.filter(
            (event) => event.workspace === info.id && event.payload.type === WorkspaceOld.Event.Status.type,
          ),
        ).toHaveLength(1)
        await WorkspaceOld.remove(info.id)
      } finally {
        captured.dispose()
      }
    })
  })

  it.live("remote start emits disconnected, connecting, and connected then refuses duplicate listeners", () => {
    const calls: FetchCall[] = []
    return Effect.gen(function* () {
      yield* HttpServer.serveEffect()(
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          const bodyText = yield* req.text
          const call = {
            url: new URL(req.url, "http://localhost"),
            method: req.method,
            headers: new Headers(req.headers),
            bodyText,
            json: bodyText ? JSON.parse(bodyText) : undefined,
          }
          calls.push(call)
          if (call.url.pathname === "/sync/global/event") return HttpServerResponse.fromWeb(eventStreamResponse())
          if (call.url.pathname === "/sync/sync/history") return HttpServerResponse.fromWeb(Response.json([]))
          return HttpServerResponse.text("unexpected", { status: 500 })
        }),
      )
      const url = yield* serverUrl()
      yield* provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const workspace = yield* WorkspaceOld.Service
            const sessionSvc = yield* SessionNs.Service
            const captured = captureGlobalEvents()
            try {
              const type = unique("remote-start")
              const info = workspaceInfo(Instance.project.id, type)
              insertWorkspace(info)
              registerAdaptor(Instance.project.id, type, remoteAdaptor(`${url}/sync`).adaptor)
              attachSessionToWorkspace((yield* sessionSvc.create({})).id, info.id)

              yield* workspace.startWorkspaceSyncing(Instance.project.id)
              yield* eventuallyEffect(
                Effect.gen(function* () {
                  expect((yield* workspace.status()).find((item) => item.workspaceID === info.id)?.status).toBe(
                    "connected",
                  )
                }),
              )
              yield* workspace.startWorkspaceSyncing(Instance.project.id)
              yield* Effect.sleep("25 millis")

              expect(
                captured.events
                  .filter(
                    (event) => event.workspace === info.id && event.payload.type === WorkspaceOld.Event.Status.type,
                  )
                  .map((event) => event.payload.properties.status),
              ).toEqual(["disconnected", "connecting", "connected"])
              expect(calls.filter((call) => call.url.pathname === "/sync/global/event")).toHaveLength(1)
              expect(calls.filter((call) => call.url.pathname === "/sync/sync/history")).toHaveLength(1)
              expect(yield* workspace.isSyncing(info.id)).toBe(true)

              yield* workspace.remove(info.id)
              expect(yield* workspace.isSyncing(info.id)).toBe(false)
            } finally {
              captured.dispose()
            }
          }),
        { git: true },
      )
    })
  })

  it.live("remote connection HTTP failures set error and clear syncing", () =>
    Effect.gen(function* () {
      yield* HttpServer.serveEffect()(
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          if (new URL(req.url, "http://localhost").pathname === "/failed/global/event")
            return HttpServerResponse.text("nope", { status: 503 })
          return HttpServerResponse.fromWeb(Response.json([]))
        }),
      )
      const url = yield* serverUrl()
      yield* provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const workspace = yield* WorkspaceOld.Service
            const sessionSvc = yield* SessionNs.Service
            const type = unique("remote-connect-fail")
            const info = workspaceInfo(Instance.project.id, type)
            insertWorkspace(info)
            registerAdaptor(Instance.project.id, type, remoteAdaptor(`${url}/failed`).adaptor)
            attachSessionToWorkspace((yield* sessionSvc.create({})).id, info.id)

            yield* workspace.startWorkspaceSyncing(Instance.project.id)

            yield* eventuallyEffect(
              Effect.gen(function* () {
                expect((yield* workspace.status()).find((item) => item.workspaceID === info.id)?.status).toBe("error")
              }),
            )
            expect(yield* workspace.isSyncing(info.id)).toBe(false)
            yield* workspace.remove(info.id)
          }),
        { git: true },
      )
    }),
  )

  it.live("remote history HTTP failures set error", () =>
    Effect.gen(function* () {
      yield* HttpServer.serveEffect()(
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          const url = new URL(req.url, "http://localhost")
          if (url.pathname === "/history-failed/global/event")
            return HttpServerResponse.fromWeb(eventStreamResponse([], false))
          if (url.pathname === "/history-failed/sync/history")
            return HttpServerResponse.text("history failed", { status: 500 })
          return HttpServerResponse.fromWeb(Response.json([]))
        }),
      )
      const url = yield* serverUrl()
      yield* provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const workspace = yield* WorkspaceOld.Service
            const sessionSvc = yield* SessionNs.Service
            const type = unique("remote-history-fail")
            const info = workspaceInfo(Instance.project.id, type)
            insertWorkspace(info)
            registerAdaptor(Instance.project.id, type, remoteAdaptor(`${url}/history-failed`).adaptor)
            attachSessionToWorkspace((yield* sessionSvc.create({})).id, info.id)

            yield* workspace.startWorkspaceSyncing(Instance.project.id)

            yield* eventuallyEffect(
              Effect.gen(function* () {
                expect((yield* workspace.status()).find((item) => item.workspaceID === info.id)?.status).toBe("error")
              }),
            )
            expect(yield* workspace.isSyncing(info.id)).toBe(false)
            yield* workspace.remove(info.id)
          }),
        { git: true },
      )
    }),
  )

  it.live("sync history sends the local sequence fence and replays returned events in workspace context", () => {
    const historyBodies: unknown[] = []
    let historySessionID: SessionID | undefined
    let historyNextSeq = 0
    return Effect.gen(function* () {
      yield* HttpServer.serveEffect()(
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          const bodyText = yield* req.text
          const url = new URL(req.url, "http://localhost")
          if (url.pathname === "/history/global/event") return HttpServerResponse.fromWeb(eventStreamResponse())
          if (url.pathname === "/history/sync/history") {
            historyBodies.push(bodyText ? JSON.parse(bodyText) : undefined)
            return HttpServerResponse.fromWeb(
              Response.json([
                {
                  id: `evt_${unique("history")}`,
                  aggregate_id: historySessionID!,
                  seq: historyNextSeq,
                  type: sessionUpdatedType(),
                  data: { sessionID: historySessionID!, info: { title: "from history" } },
                },
              ]),
            )
          }
          return HttpServerResponse.text("unexpected", { status: 500 })
        }),
      )
      const url = yield* serverUrl()
      yield* provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const workspace = yield* WorkspaceOld.Service
            const sessionSvc = yield* SessionNs.Service
            const captured = captureGlobalEvents()
            try {
              const type = unique("history-replay")
              const info = workspaceInfo(Instance.project.id, type)
              insertWorkspace(info)
              registerAdaptor(Instance.project.id, type, remoteAdaptor(`${url}/history`).adaptor)
              const session = yield* sessionSvc.create({ title: "before history" })
              attachSessionToWorkspace(session.id, info.id)
              historySessionID = session.id
              historyNextSeq = (sessionSequence(session.id) ?? -1) + 1

              yield* workspace.startWorkspaceSyncing(Instance.project.id)

              yield* eventuallyEffect(
                Effect.gen(function* () {
                  expect((yield* sessionSvc.get(session.id)).title).toBe("from history")
                }),
              )
              expect(historyBodies).toEqual([{ [session.id]: historyNextSeq - 1 }])
              expect(
                captured.events.some(
                  (event) =>
                    event.workspace === info.id &&
                    event.payload.type === "sync" &&
                    event.payload.syncEvent.seq === historyNextSeq,
                ),
              ).toBe(true)
              yield* workspace.remove(info.id)
            } finally {
              captured.dispose()
            }
          }),
        { git: true },
      )
    })
  })

  it.live("SSE forwards non-heartbeat events and ignores heartbeats", () =>
    Effect.gen(function* () {
      yield* HttpServer.serveEffect()(
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          const url = new URL(req.url, "http://localhost")
          if (url.pathname === "/sse-forward/global/event")
            return HttpServerResponse.fromWeb(
              eventStreamResponse(
                [
                  { directory: "remote-dir", project: "remote-project", payload: { type: "server.heartbeat" } },
                  {
                    directory: "remote-dir",
                    project: "remote-project",
                    payload: { type: "custom.remote", properties: { ok: true } },
                  },
                ],
                false,
              ),
            )
          if (url.pathname === "/sse-forward/sync/history") return HttpServerResponse.fromWeb(Response.json([]))
          return HttpServerResponse.text("unexpected", { status: 500 })
        }),
      )
      const url = yield* serverUrl()
      yield* provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const workspace = yield* WorkspaceOld.Service
            const sessionSvc = yield* SessionNs.Service
            const captured = captureGlobalEvents()
            try {
              const type = unique("sse-forward")
              const info = workspaceInfo(Instance.project.id, type)
              insertWorkspace(info)
              registerAdaptor(Instance.project.id, type, remoteAdaptor(`${url}/sse-forward`).adaptor)
              attachSessionToWorkspace((yield* sessionSvc.create({})).id, info.id)

              yield* workspace.startWorkspaceSyncing(Instance.project.id)

              yield* eventuallyEffect(
                Effect.sync(() =>
                  expect(
                    captured.events.some(
                      (event) => event.workspace === info.id && event.payload.type === "custom.remote",
                    ),
                  ).toBe(true),
                ),
              )
              expect(
                captured.events.some(
                  (event) => event.workspace === info.id && event.payload.type === "server.heartbeat",
                ),
              ).toBe(false)
              expect(
                captured.events.find((event) => event.workspace === info.id && event.payload.type === "custom.remote"),
              ).toMatchObject({
                directory: "remote-dir",
                project: "remote-project",
                payload: { properties: { ok: true } },
              })
              yield* workspace.remove(info.id)
            } finally {
              captured.dispose()
            }
          }),
        { git: true },
      )
    }),
  )

  it.live("SSE sync events are replayed and forwarded", () => {
    let sseSessionID: SessionID | undefined
    let sseNextSeq = 0
    return Effect.gen(function* () {
      yield* HttpServer.serveEffect()(
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          const url = new URL(req.url, "http://localhost")
          if (url.pathname === "/sse-sync/global/event")
            return HttpServerResponse.fromWeb(
              eventStreamResponse(
                [
                  {
                    directory: "remote-dir",
                    project: "remote-project",
                    payload: {
                      type: "sync",
                      syncEvent: {
                        id: `evt_${unique("sse")}`,
                        aggregateID: sseSessionID!,
                        seq: sseNextSeq,
                        type: sessionUpdatedType(),
                        data: { sessionID: sseSessionID!, info: { title: "from sse" } },
                      },
                    },
                  },
                ],
                false,
              ),
            )
          if (url.pathname === "/sse-sync/sync/history") return HttpServerResponse.fromWeb(Response.json([]))
          return HttpServerResponse.text("unexpected", { status: 500 })
        }),
      )
      const url = yield* serverUrl()
      yield* provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const workspace = yield* WorkspaceOld.Service
            const sessionSvc = yield* SessionNs.Service
            const captured = captureGlobalEvents()
            try {
              const type = unique("sse-sync")
              const info = workspaceInfo(Instance.project.id, type)
              insertWorkspace(info)
              registerAdaptor(Instance.project.id, type, remoteAdaptor(`${url}/sse-sync`).adaptor)
              const session = yield* sessionSvc.create({ title: "before sse" })
              attachSessionToWorkspace(session.id, info.id)
              sseSessionID = session.id
              sseNextSeq = (sessionSequence(session.id) ?? -1) + 1

              yield* workspace.startWorkspaceSyncing(Instance.project.id)

              yield* eventuallyEffect(
                Effect.gen(function* () {
                  expect((yield* sessionSvc.get(session.id)).title).toBe("from sse")
                }),
              )
              expect(
                captured.events.some(
                  (event) =>
                    event.workspace === info.id &&
                    event.payload.type === "sync" &&
                    event.payload.syncEvent.seq === sseNextSeq,
                ),
              ).toBe(true)
              yield* workspace.remove(info.id)
            } finally {
              captured.dispose()
            }
          }),
        { git: true },
      )
    })
  })
})

describe("workspace-old waitForSync", () => {
  test("returns immediately for an empty fence", async () => {
    await withInstance(async () => {
      await expect(WorkspaceOld.waitForSync(WorkspaceID.ascending("wrk_wait_empty"), {})).resolves.toBeUndefined()
    })
  })

  test("returns immediately when the stored sequence already satisfies the fence", async () => {
    await withInstance(async () => {
      const sessionID = SessionID.descending("ses_wait_done")
      Database.use((db) => db.insert(EventSequenceTable).values({ aggregate_id: sessionID, seq: 4 }).run())

      await expect(
        WorkspaceOld.waitForSync(WorkspaceID.ascending("wrk_wait_done"), { [sessionID]: 4 }),
      ).resolves.toBeUndefined()
      await expect(
        WorkspaceOld.waitForSync(WorkspaceID.ascending("wrk_wait_done_2"), { [sessionID]: 3 }),
      ).resolves.toBeUndefined()
    })
  })

  test("waits until the database reaches the requested sequence and a workspace event arrives", async () => {
    await withInstance(async () => {
      const workspaceID = WorkspaceID.ascending("wrk_wait_event")
      const sessionID = SessionID.descending("ses_wait_event")
      Database.use((db) => db.insert(EventSequenceTable).values({ aggregate_id: sessionID, seq: 1 }).run())

      const waited = WorkspaceOld.waitForSync(workspaceID, { [sessionID]: 2 })
      await delay(10)
      Database.use((db) =>
        db.update(EventSequenceTable).set({ seq: 2 }).where(eq(EventSequenceTable.aggregate_id, sessionID)).run(),
      )
      GlobalBus.emit("event", { workspace: workspaceID, payload: { type: "anything" } })

      await expect(waited).resolves.toBeUndefined()
    })
  })

  test("a sync event for a different workspace can also release the fence", async () => {
    await withInstance(async () => {
      const workspaceID = WorkspaceID.ascending("wrk_wait_sync_any")
      const sessionID = SessionID.descending("ses_wait_sync_any")
      Database.use((db) => db.insert(EventSequenceTable).values({ aggregate_id: sessionID, seq: 0 }).run())

      const waited = WorkspaceOld.waitForSync(workspaceID, { [sessionID]: 1 })
      await delay(10)
      Database.use((db) =>
        db.update(EventSequenceTable).set({ seq: 1 }).where(eq(EventSequenceTable.aggregate_id, sessionID)).run(),
      )
      GlobalBus.emit("event", {
        workspace: WorkspaceID.ascending("wrk_other_workspace"),
        payload: { type: "sync" },
      })

      await expect(waited).resolves.toBeUndefined()
    })
  })

  test("rejects with the abort reason when aborted", async () => {
    await withInstance(async () => {
      const abort = new AbortController()
      const reason = new Error("caller aborted")
      const waited = WorkspaceOld.waitForSync(
        WorkspaceID.ascending("wrk_wait_abort"),
        { [SessionID.descending("ses_wait_abort")]: 1 },
        abort.signal,
      )
      abort.abort(reason)

      await expect(waited).rejects.toMatchObject({
        _tag: "WorkspaceSyncAbortedError",
        message: reason.message,
        cause: reason,
      })
    })
  })

  test("times out with the requested fence in the error message", async () => {
    await withInstance(async () => {
      const sessionID = SessionID.descending("ses_wait_timeout")

      await expect(
        WorkspaceOld.waitForSync(WorkspaceID.ascending("wrk_wait_timeout"), { [sessionID]: 1 }),
      ).rejects.toThrow(`Timed out waiting for sync fence: {"${sessionID}":1}`)
    })
  }, 7000)
})

describe("workspace-old sessionRestore", () => {
  test("throws when the workspace is missing", async () => {
    await withInstance(async () => {
      await expect(
        WorkspaceOld.sessionRestore({
          workspaceID: WorkspaceID.ascending("wrk_restore_missing"),
          sessionID: SessionID.descending("ses_restore_missing_workspace"),
        }),
      ).rejects.toThrow("Workspace not found: wrk_restore_missing")
    })
  })

  test("throws when switching a missing session fails", async () => {
    await withInstance(async (dir) => {
      const type = unique("restore-missing-session")
      const info = workspaceInfo(Instance.project.id, type, { directory: dir })
      insertWorkspace(info)
      registerAdaptor(Instance.project.id, type, localAdaptor(dir).adaptor)

      await expect(
        WorkspaceOld.sessionRestore({ workspaceID: info.id, sessionID: SessionID.descending("ses_missing_restore") }),
      ).rejects.toThrow("NotFoundError")
      await WorkspaceOld.remove(info.id)
    })
  })

  it.live("posts remote replay batches of 10, emits progress, and includes the workspace update event", () => {
    const replay: FetchCall[] = []
    return Effect.gen(function* () {
      yield* HttpServer.serveEffect()(
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          const bodyText = yield* req.text
          const call = {
            url: new URL(req.url, "http://localhost"),
            method: req.method,
            headers: new Headers(req.headers),
            bodyText,
            json: bodyText ? JSON.parse(bodyText) : undefined,
          }
          if (call.url.pathname === "/restore/sync/replay") {
            replay.push(call)
            return HttpServerResponse.fromWeb(Response.json({ ok: true }))
          }
          return HttpServerResponse.text("unexpected", { status: 500 })
        }),
      )
      const url = yield* serverUrl()
      yield* provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const workspace = yield* WorkspaceOld.Service
            const sessionSvc = yield* SessionNs.Service
            const captured = captureGlobalEvents()
            try {
              const type = unique("restore-remote")
              const info = workspaceInfo(Instance.project.id, type, { directory: dir })
              insertWorkspace(info)
              registerAdaptor(
                Instance.project.id,
                type,
                remoteAdaptor(`${url}/restore/?ignored=1#hash`, {
                  directory: dir,
                  headers: { authorization: "Bearer restore" },
                }).adaptor,
              )
              const session = yield* sessionSvc.create({ title: "restore remote" })
              replaceSessionEvents(session.id, 24)

              const result = yield* workspace.sessionRestore({ workspaceID: info.id, sessionID: session.id })

              expect(result).toEqual({ total: 3 })
              expect(replay).toHaveLength(3)
              expect(replay.map((call) => call.url.pathname + call.url.search + call.url.hash)).toEqual([
                "/restore/sync/replay",
                "/restore/sync/replay",
                "/restore/sync/replay",
              ])
              expect(replay.every((call) => call.headers.get("authorization") === "Bearer restore")).toBe(true)
              expect(replay.every((call) => call.headers.get("content-type") === "application/json")).toBe(true)
              expect(replay.map((call) => (call.json as { events: unknown[] }).events.length)).toEqual([10, 10, 5])
              expect(replay.map((call) => (call.json as { directory: string }).directory)).toEqual([dir, dir, dir])
              expect(
                replay.flatMap((call) =>
                  (call.json as { events: Array<{ seq: number }> }).events.map((event) => event.seq),
                ),
              ).toEqual(Array.from({ length: 25 }, (_, i) => i))
              expect(
                (replay[2].json as { events: Array<{ seq: number; type: string; data: unknown }> }).events.at(-1),
              ).toMatchObject({
                seq: 24,
                type: sessionUpdatedType(),
                data: { sessionID: session.id, info: { workspaceID: info.id } },
              })
              expect((yield* sessionSvc.get(session.id)).workspaceID).toBe(info.id)
              expect(
                captured.events
                  .filter(
                    (event) => event.workspace === info.id && event.payload.type === WorkspaceOld.Event.Restore.type,
                  )
                  .map((event) => event.payload.properties.step),
              ).toEqual([0, 1, 2, 3])
              yield* workspace.remove(info.id)
            } finally {
              captured.dispose()
            }
          }),
        { git: true },
      )
    })
  })

  it.live("remote restore sends an empty directory string when the workspace directory is null", () => {
    const replay: FetchCall[] = []
    return Effect.gen(function* () {
      yield* HttpServer.serveEffect()(
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          const bodyText = yield* req.text
          replay.push({
            url: new URL(req.url, "http://localhost"),
            method: req.method,
            headers: new Headers(req.headers),
            bodyText,
            json: bodyText ? JSON.parse(bodyText) : undefined,
          })
          return HttpServerResponse.fromWeb(Response.json({ ok: true }))
        }),
      )
      const url = yield* serverUrl()
      yield* provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const workspace = yield* WorkspaceOld.Service
            const sessionSvc = yield* SessionNs.Service
            const type = unique("restore-null-dir")
            const info = workspaceInfo(Instance.project.id, type, { directory: null })
            insertWorkspace(info)
            registerAdaptor(Instance.project.id, type, remoteAdaptor(`${url}/null-dir`, { directory: null }).adaptor)
            const session = yield* sessionSvc.create({ title: "null dir" })
            replaceSessionEvents(session.id, 0)

            expect(yield* workspace.sessionRestore({ workspaceID: info.id, sessionID: session.id })).toEqual({
              total: 1,
            })
            expect((replay[0].json as { directory: string }).directory).toBe("")
            expect((replay[0].json as { events: unknown[] }).events).toHaveLength(1)
            yield* workspace.remove(info.id)
          }),
        { git: true },
      )
    })
  })

  it.live("remote restore failures include status and body and do not emit completed batch progress", () => {
    const replay: FetchCall[] = []
    return Effect.gen(function* () {
      yield* HttpServer.serveEffect()(
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          const bodyText = yield* req.text
          replay.push({
            url: new URL(req.url, "http://localhost"),
            method: req.method,
            headers: new Headers(req.headers),
            bodyText,
            json: bodyText ? JSON.parse(bodyText) : undefined,
          })
          return HttpServerResponse.text("replay failed", { status: 503 })
        }),
      )
      const url = yield* serverUrl()
      yield* provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const workspace = yield* WorkspaceOld.Service
            const sessionSvc = yield* SessionNs.Service
            const captured = captureGlobalEvents()
            try {
              const type = unique("restore-remote-fail")
              const info = workspaceInfo(Instance.project.id, type, { directory: dir })
              insertWorkspace(info)
              registerAdaptor(Instance.project.id, type, remoteAdaptor(`${url}/fail`, { directory: dir }).adaptor)
              const session = yield* sessionSvc.create({ title: "restore fail" })
              replaceSessionEvents(session.id, 11)

              const error = yield* Effect.flip(
                workspace.sessionRestore({ workspaceID: info.id, sessionID: session.id }),
              )
              expect((error as Error).message).toContain(
                `Failed to replay session ${session.id} into workspace ${info.id}: HTTP 503 replay failed`,
              )

              expect(replay).toHaveLength(1)
              expect(
                captured.events
                  .filter(
                    (event) => event.workspace === info.id && event.payload.type === WorkspaceOld.Event.Restore.type,
                  )
                  .map((event) => event.payload.properties.step),
              ).toEqual([0])
              yield* workspace.remove(info.id)
            } finally {
              captured.dispose()
            }
          }),
        { git: true },
      )
    })
  })

  test("local restore replays batches without fetch and emits progress", async () => {
    await withInstance(async (dir) => {
      const captured = captureGlobalEvents()
      let fetchCallCount = 0
      const replayAll = spyOn(SyncEvent, "replayAll")
      try {
        using server = Bun.serve({
          port: 0,
          fetch() {
            fetchCallCount++
            return Response.json({ ok: true })
          },
        })
        const type = unique("restore-local")
        const info = workspaceInfo(Instance.project.id, type, { directory: dir })
        insertWorkspace(info)
        registerAdaptor(Instance.project.id, type, localAdaptor(dir).adaptor)
        const session = await AppRuntime.runPromise(
          SessionNs.Service.use((svc) => svc.create({ title: "restore local" })),
        )
        replaceSessionEvents(session.id, 20)

        expect(await WorkspaceOld.sessionRestore({ workspaceID: info.id, sessionID: session.id })).toEqual({ total: 3 })

        expect(fetchCallCount).toBe(0)
        expect(replayAll).toHaveBeenCalledTimes(3)
        expect(replayAll.mock.calls.map((call) => call[0].length)).toEqual([10, 10, 1])
        expect((await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.get(session.id)))).workspaceID).toBe(
          info.id,
        )
        expect(eventRows(session.id).map((row) => row.seq)).toEqual(Array.from({ length: 21 }, (_, i) => i))
        expect(
          captured.events
            .filter((event) => event.workspace === info.id && event.payload.type === WorkspaceOld.Event.Restore.type)
            .map((event) => event.payload.properties.step),
        ).toEqual([0, 1, 2, 3])
        await WorkspaceOld.remove(info.id)
      } finally {
        captured.dispose()
      }
    })
  })

  it.live("session restore includes real message and part events in sequence order", () => {
    const replay: FetchCall[] = []
    return Effect.gen(function* () {
      yield* HttpServer.serveEffect()(
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          const bodyText = yield* req.text
          replay.push({
            url: new URL(req.url, "http://localhost"),
            method: req.method,
            headers: new Headers(req.headers),
            bodyText,
            json: bodyText ? JSON.parse(bodyText) : undefined,
          })
          return HttpServerResponse.fromWeb(Response.json({ ok: true }))
        }),
      )
      const url = yield* serverUrl()
      yield* provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const workspace = yield* WorkspaceOld.Service
            const sessionSvc = yield* SessionNs.Service
            const type = unique("restore-real-events")
            const info = workspaceInfo(Instance.project.id, type, { directory: dir })
            insertWorkspace(info)
            registerAdaptor(Instance.project.id, type, remoteAdaptor(`${url}/real`, { directory: dir }).adaptor)
            const session = yield* sessionSvc.create({ title: "real events" })
            for (let i = 0; i < 3; i++) {
              const msg = yield* sessionSvc.updateMessage({
                id: MessageID.ascending(),
                role: "user",
                sessionID: session.id,
                agent: "build",
                model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
                time: { created: Date.now() },
              })
              yield* sessionSvc.updatePart({
                id: PartID.ascending(),
                sessionID: session.id,
                messageID: msg.id,
                type: "text",
                text: `message ${i}`,
              })
            }
            const before = eventRows(session.id)

            expect(yield* workspace.sessionRestore({ workspaceID: info.id, sessionID: session.id })).toEqual({
              total: 1,
            })

            const posted = (replay[0].json as { events: Array<{ seq: number; type: string }> }).events
            expect(posted.map((event) => event.seq)).toEqual([...before.map((row) => row.seq), before.at(-1)!.seq + 1])
            expect(posted.map((event) => event.type).slice(0, -1)).toEqual(before.map((row) => row.type))
            expect(posted.at(-1)?.type).toBe(sessionUpdatedType())
            yield* workspace.remove(info.id)
          }),
        { git: true },
      )
    })
  })
})
