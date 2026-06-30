import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Context, Effect, FiberMap, Iterable, Layer, Schema, Stream } from "effect"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { FetchHttpClient, HttpBody, HttpClient, HttpClientError, HttpClientRequest } from "effect/unstable/http"
import { Database } from "@opencode-ai/core/database/database"
import { asc } from "drizzle-orm"
import { eq } from "drizzle-orm"
import { inArray } from "drizzle-orm"
import { Project } from "@/project/project"
import { GlobalBus } from "@/bus/global"
import { Auth } from "@/auth"
import { EventV2 } from "@opencode-ai/core/event"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Slug } from "@opencode-ai/core/util/slug"
import { WorkspaceTable } from "@opencode-ai/core/control-plane/workspace.sql"
import { getAdapter, registeredAdapters } from "./adapters"
import { type Target, type WorkspaceInfo, WorkspaceInfo as WorkspaceInfoSchema } from "./types"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionID } from "@/session/schema"
import { NotFoundError } from "@/storage/storage"
import { errorData } from "@/util/error"
import { waitEvent } from "./util"
import { WorkspaceRef } from "@/effect/instance-ref"
import { Vcs } from "@/project/vcs"
import { InstanceStore } from "@/project/instance-store"
import { WorkspaceAdapterRuntime } from "./workspace-adapter-runtime"
import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { WorkspaceEvent } from "@opencode-ai/schema/workspace-event"

export const Info = Schema.Struct({
  ...WorkspaceInfoSchema.fields,
  timeUsed: Schema.Number,
}).annotate({ identifier: "Workspace" })
export type Info = WorkspaceInfo & { timeUsed: number }

export const ConnectionStatus = WorkspaceEvent.ConnectionStatus
export type ConnectionStatus = WorkspaceEvent.ConnectionStatus

export const Event = WorkspaceEvent

function fromRow(row: typeof WorkspaceTable.$inferSelect): Info {
  return {
    id: row.id,
    type: row.type,
    branch: row.branch,
    name: row.name,
    directory: row.directory,
    extra: row.extra,
    projectID: row.project_id,
    timeUsed: row.time_used,
  }
}

export const CreateInput = Schema.Struct({
  id: Schema.optional(WorkspaceV2.ID),
  type: Info.fields.type,
  branch: Info.fields.branch,
  projectID: ProjectV2.ID,
  extra: Schema.optional(Info.fields.extra),
})
export type CreateInput = Schema.Schema.Type<typeof CreateInput>

export const SessionWarpInput = Schema.Struct({
  workspaceID: Schema.NullOr(WorkspaceV2.ID),
  sessionID: SessionID,
  copyChanges: Schema.optional(Schema.Boolean),
})
export type SessionWarpInput = Schema.Schema.Type<typeof SessionWarpInput>

export class SyncHttpError extends Schema.TaggedErrorClass<SyncHttpError>()("WorkspaceSyncHttpError", {
  message: Schema.String,
  status: Schema.Number,
  body: Schema.optional(Schema.String),
}) {}

export class WorkspaceNotFoundError extends Schema.TaggedErrorClass<WorkspaceNotFoundError>()(
  "WorkspaceNotFoundError",
  {
    message: Schema.String,
    workspaceID: WorkspaceV2.ID,
  },
) {}

export class SessionEventsNotFoundError extends Schema.TaggedErrorClass<SessionEventsNotFoundError>()(
  "WorkspaceSessionEventsNotFoundError",
  {
    message: Schema.String,
    sessionID: SessionID,
  },
) {}

export class SessionWarpHttpError extends Schema.TaggedErrorClass<SessionWarpHttpError>()(
  "WorkspaceSessionWarpHttpError",
  {
    message: Schema.String,
    workspaceID: WorkspaceV2.ID,
    sessionID: SessionID,
    status: Schema.Number,
    body: Schema.String,
  },
) {}

export class SyncTimeoutError extends Schema.TaggedErrorClass<SyncTimeoutError>()("WorkspaceSyncTimeoutError", {
  message: Schema.String,
  state: Schema.Record(Schema.String, Schema.Number),
}) {}

export class SyncAbortedError extends Schema.TaggedErrorClass<SyncAbortedError>()("WorkspaceSyncAbortedError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

type CreateError = Auth.AuthError
type SessionWarpError =
  | WorkspaceNotFoundError
  | SessionEventsNotFoundError
  | SessionWarpHttpError
  | Vcs.PatchApplyError
  | HttpClientError.HttpClientError
type WaitForSyncError = SyncTimeoutError | SyncAbortedError
type SyncLoopError = SyncHttpError | HttpClientError.HttpClientError

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info, CreateError>
  readonly sessionWarp: (input: SessionWarpInput) => Effect.Effect<void, SessionWarpError>
  readonly list: (project: Project.Info) => Effect.Effect<Info[]>
  readonly syncList: (project: Project.Info) => Effect.Effect<void>
  readonly get: (id: WorkspaceV2.ID) => Effect.Effect<Info | undefined>
  readonly remove: (id: WorkspaceV2.ID) => Effect.Effect<Info | undefined>
  readonly status: () => Effect.Effect<ConnectionStatus[]>
  readonly isSyncing: (workspaceID: WorkspaceV2.ID) => Effect.Effect<boolean>
  readonly waitForSync: (
    workspaceID: WorkspaceV2.ID,
    state: Record<string, number>,
    signal?: AbortSignal,
    timeout?: number,
  ) => Effect.Effect<void, WaitForSyncError>
  readonly startWorkspaceSyncing: (projectID: ProjectV2.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Workspace") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const session = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const http = yield* HttpClient.HttpClient
    const events = yield* EventV2Bridge.Service
    const vcs = yield* Vcs.Service
    const flags = yield* RuntimeFlags.Service
    const fs = yield* FSUtil.Service
    const { db } = yield* Database.Service
    const connections = new Map<WorkspaceV2.ID, ConnectionStatus>()
    const syncFibers = yield* FiberMap.make<WorkspaceV2.ID, void, SyncLoopError>()

    const setStatus = (id: WorkspaceV2.ID, status: ConnectionStatus["status"]) => {
      const prev = connections.get(id)
      if (prev?.status === status) return
      const next = { workspaceID: id, status }
      connections.set(id, next)

      GlobalBus.emit("event", {
        directory: "global",
        workspace: id,
        payload: {
          type: Event.Status.type,
          properties: next,
        },
      })
    }

    const connectSSE = Effect.fn("Workspace.connectSSE")(function* (
      url: URL | string,
      headers: HeadersInit | undefined,
    ) {
      const response = yield* http.execute(
        HttpClientRequest.get(route(url, "/global/event"), {
          headers: new Headers(headers),
          accept: "text/event-stream",
        }),
      )
      if (response.status < 200 || response.status >= 300) {
        return yield* new SyncHttpError({
          message: `Workspace sync HTTP failure: ${response.status}`,
          status: response.status,
        })
      }
      return response.stream
    })

    const parseSSE = Effect.fn("Workspace.parseSSE")(function* (
      stream: Stream.Stream<Uint8Array, unknown>,
      onEvent: (event: unknown) => Effect.Effect<void>,
    ) {
      yield* stream.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.mapAccum(
          () => ({ data: [] as string[], id: undefined as string | undefined, retry: 1000 }),
          (state, line) => {
            if (line === "") {
              if (!state.data.length) return [state, []]
              return [{ ...state, data: [] }, [{ data: state.data.join("\n"), id: state.id, retry: state.retry }]]
            }

            const index = line.indexOf(":")
            const field = index === -1 ? line : line.slice(0, index)
            const value = index === -1 ? "" : line.slice(index + (line[index + 1] === " " ? 2 : 1))

            if (field === "data") return [{ ...state, data: [...state.data, value] }, []]
            if (field === "id") return [{ ...state, id: value }, []]
            if (field === "retry") {
              const retry = Number.parseInt(value, 10)
              return [Number.isNaN(retry) ? state : { ...state, retry }, []]
            }
            return [state, []]
          },
          {
            onHalt: (state) =>
              state.data.length ? [{ data: state.data.join("\n"), id: state.id, retry: state.retry }] : [],
          },
        ),
        Stream.map((event) => {
          try {
            return JSON.parse(event.data) as unknown
          } catch {
            return {
              type: "sse.message",
              properties: {
                data: event.data,
                id: event.id || undefined,
                retry: event.retry,
              },
            }
          }
        }),
        Stream.runForEach(onEvent),
      )
    })

    const runInWorkspace = <A, E, R>(input: {
      workspaceID?: WorkspaceV2.ID
      local: () => Effect.Effect<A, E, R>
      remote: (input: {
        workspace: Info
        target: Extract<Target, { type: "remote" }>
      }) => HttpClientRequest.HttpClientRequest
      fallback: A
      response?: "json" | "text"
    }) =>
      Effect.gen(function* () {
        if (!input.workspaceID) return yield* input.local()

        const workspace = yield* get(input.workspaceID)
        if (!workspace) return input.fallback

        const target = yield* WorkspaceAdapterRuntime.target(workspace)

        if (target.type === "local") {
          const store = yield* InstanceStore.Service
          return yield* store.provide({ directory: target.directory }, input.local())
        }

        const response = yield* http.execute(input.remote({ workspace, target })).pipe(
          Effect.catch((error) =>
            Effect.logWarning("workspace target request failed", {
              workspaceID: workspace.id,
              error: errorData(error),
            }).pipe(Effect.as(undefined)),
          ),
        )
        if (!response) return input.fallback
        if (response.status < 200 || response.status >= 300) {
          const body = yield* response.text.pipe(Effect.catch(() => Effect.succeed("")))
          yield* Effect.logWarning("workspace target request failed", {
            workspaceID: workspace.id,
            status: response.status,
            body,
          })
          return input.fallback
        }

        const body = input.response === "text" ? response.text : response.json
        return yield* body.pipe(
          Effect.map((result) => result as A),
          Effect.catch((error) =>
            Effect.logWarning("workspace target response decode failed", {
              workspaceID: workspace.id,
              error: errorData(error),
            }).pipe(Effect.as(input.fallback)),
          ),
        )
      })

    const syncHistory = Effect.fn("Workspace.syncHistory")(function* (
      space: Info,
      url: URL | string,
      headers: HeadersInit | undefined,
    ) {
      const sessionIDs = (yield* db
        .select({ id: SessionTable.id })
        .from(SessionTable)
        .where(eq(SessionTable.workspace_id, space.id))
        .all()
        .pipe(Effect.orDie)).map((row) => row.id)
      const state = sessionIDs.length
        ? Object.fromEntries(
            (yield* db
              .select()
              .from(EventSequenceTable)
              .where(inArray(EventSequenceTable.aggregate_id, sessionIDs))
              .all()
              .pipe(Effect.orDie)).map((row) => [row.aggregate_id, row.seq]),
          )
        : {}

      const response = yield* http.execute(
        HttpClientRequest.post(route(url, "/sync/history"), {
          headers: new Headers(headers),
          body: HttpBody.jsonUnsafe(state),
        }),
      )

      if (response.status < 200 || response.status >= 300) {
        const body = yield* response.text
        return yield* new SyncHttpError({
          message: `Workspace history HTTP failure: ${response.status} ${body}`,
          status: response.status,
          body,
        })
      }

      const history = (yield* response.json) as HistoryEvent[]

      yield* Effect.forEach(
        history,
        (event) =>
          events
            .replay(
              {
                id: EventV2.ID.make(event.id),
                aggregateID: event.aggregate_id,
                seq: event.seq,
                type: event.type,
                data: event.data,
              },
              { publish: true, ownerID: space.id },
            )
            .pipe(Effect.provideService(WorkspaceRef, space.id)),
        { discard: true },
      )
    })

    const syncWorkspaceLoop = Effect.fn("Workspace.syncWorkspaceLoop")(function* (space: Info) {
      const target = yield* WorkspaceAdapterRuntime.target(space)

      if (target.type === "local") return

      let attempt = 0

      while (true) {
        setStatus(space.id, "connecting")

        const stream = yield* connectSSE(target.url, target.headers).pipe(
          Effect.tap(() => syncHistory(space, target.url, target.headers)),
          Effect.catch((err) =>
            Effect.gen(function* () {
              setStatus(space.id, "error")
              yield* Effect.logWarning("failed to connect to global sync", {
                workspace: space.name,
                error: errorData(err),
              })
              return null
            }),
          ),
        )

        if (stream) {
          attempt = 0

          setStatus(space.id, "connected")

          yield* parseSSE(stream, (evt) =>
            Effect.gen(function* () {
              if (!evt || typeof evt !== "object" || !("payload" in evt)) return
              const payload = evt.payload as { type?: string; syncEvent?: EventV2.SerializedEvent }
              if (payload.type === "server.heartbeat") return

              if (payload.type === "sync" && payload.syncEvent) {
                const failed = yield* events.replay(payload.syncEvent, { publish: true, ownerID: space.id }).pipe(
                  Effect.as(false),
                  Effect.catchCause((error) =>
                    Effect.logWarning("failed to replay global event", error).pipe(
                      Effect.annotateLogs({ workspaceID: space.id }),
                      Effect.as(true),
                    ),
                  ),
                )
                if (failed) return
              }

              try {
                const event = evt as { directory?: string; project?: string; payload: unknown }
                GlobalBus.emit("event", {
                  directory: event.directory,
                  project: event.project,
                  workspace: space.id,
                  payload: event.payload,
                })
              } catch (error) {
                yield* Effect.logWarning("failed to emit global event", {
                  workspaceID: space.id,
                  error: errorData(error),
                })
              }
            }),
          )

          setStatus(space.id, "disconnected")
        }

        // Back off reconnect attempts up to 2 minutes while the workspace
        // stays unavailable.
        yield* Effect.sleep(`${Math.min(120_000, 1_000 * 2 ** attempt)} millis`)
        attempt += 1
      }
    })

    const startSync = Effect.fn("Workspace.startSync")(function* (space: Info) {
      if (!flags.experimentalWorkspaces) return

      const target = yield* WorkspaceAdapterRuntime.target(space).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            setStatus(space.id, "error")
            yield* Effect.logWarning("workspace target failed", {
              workspaceID: space.id,
              error: errorData(error),
            })
            return null
          }),
        ),
      )
      if (!target) return

      if (target.type === "local") {
        setStatus(space.id, (yield* fs.existsSafe(target.directory)) ? "connected" : "error")
        return
      }

      const exists = yield* FiberMap.has(syncFibers, space.id)
      if (exists && connections.get(space.id)?.status !== "error") return

      setStatus(space.id, "disconnected")

      yield* FiberMap.run(
        syncFibers,
        space.id,
        // TODO: look into `tapError` to set the status but still
        // allow the fiber to fail and automatically get removed
        syncWorkspaceLoop(space).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              setStatus(space.id, "error")
              yield* Effect.logWarning("workspace listener failed", {
                workspaceID: space.id,
                error: errorData(error),
              })
            }),
          ),
        ),
      )
    })

    const stopSync = Effect.fn("Workspace.stopSync")(function* (id: WorkspaceV2.ID) {
      yield* FiberMap.remove(syncFibers, id)
      connections.delete(id)
    })

    const create = Effect.fn("Workspace.create")(function* (input: CreateInput) {
      const id = WorkspaceV2.ID.ascending(input.id)
      const adapter = getAdapter(input.projectID, input.type)
      const config = yield* WorkspaceAdapterRuntime.configure(adapter, {
        ...input,
        id,
        name: Slug.create(),
        directory: null,
        extra: input.extra ?? null,
      })

      const info: Info = {
        id,
        type: config.type,
        branch: config.branch ?? null,
        name: config.name ?? null,
        directory: config.directory ?? null,
        extra: config.extra ?? null,
        projectID: input.projectID,
        timeUsed: Date.now(),
      }

      yield* db
        .insert(WorkspaceTable)
        .values({
          id: info.id,
          type: info.type,
          branch: info.branch,
          name: info.name,
          directory: info.directory,
          extra: info.extra,
          project_id: info.projectID,
          time_used: info.timeUsed,
        })
        .run()
        .pipe(Effect.orDie)

      const env = {
        OPENCODE_AUTH_CONTENT: JSON.stringify(yield* auth.all()),
        OPENCODE_WORKSPACE_ID: config.id,
        OPENCODE_EXPERIMENTAL_WORKSPACES: "true",
        OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS,
        OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        OTEL_RESOURCE_ATTRIBUTES: process.env.OTEL_RESOURCE_ATTRIBUTES,
      }

      yield* WorkspaceAdapterRuntime.create(adapter, config, env)
      yield* Effect.all(
        [
          waitEvent({
            timeout: TIMEOUT,
            fn(event) {
              if (event.workspace === info.id && event.payload.type === Event.Status.type) {
                const { status } = event.payload.properties
                return status === "error" || status === "connected"
              }
              return false
            },
          }),
          startSync(info),
        ],
        { concurrency: 2, discard: true },
      )

      return info
    })

    const sessionWarp = Effect.fn("Workspace.sessionWarp")(function* (input: SessionWarpInput) {
      return yield* Effect.gen(function* () {
        const current = yield* db
          .select({ workspaceID: SessionTable.workspace_id })
          .from(SessionTable)
          .where(eq(SessionTable.id, input.sessionID))
          .get()
          .pipe(Effect.orDie)

        if (current?.workspaceID) {
          const previous = yield* get(current.workspaceID)
          if (previous) {
            const target = yield* WorkspaceAdapterRuntime.target(previous)

            if (target.type === "remote") {
              yield* syncHistory(previous, target.url, target.headers).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("session warp final source sync failed", {
                    workspaceID: previous.id,
                    sessionID: input.sessionID,
                    error: errorData(error),
                  }),
                ),
              )
            } else {
              yield* prompt.cancel(input.sessionID)
            }

            // "claim" this session so any future events coming from
            // the old workspace are ignored
            yield* events.claim(input.sessionID, input.workspaceID ?? previous.projectID)
          }
        }

        const sourcePatch =
          input.copyChanges && current?.workspaceID
            ? yield* runInWorkspace({
                workspaceID: current?.workspaceID ?? undefined,
                local: () => vcs.diffRaw(),
                remote: ({ target }) =>
                  HttpClientRequest.get(route(target.url, "/vcs/diff/raw"), {
                    headers: new Headers(target.headers),
                  }),
                fallback: "",
                response: "text",
              }).pipe(Effect.provide(AppNodeBuilderV1.build(InstanceStore.node)))
            : ""

        if (sourcePatch) {
          // Attempt to apply the file changes to the new workspace.
          // We intentionally do first so if it fails we don't warp
          // the session.
          yield* runInWorkspace({
            workspaceID: input.workspaceID ?? undefined,
            local: () => vcs.apply({ patch: sourcePatch }),
            remote: ({ target }) =>
              HttpClientRequest.post(route(target.url, "/vcs/apply"), {
                headers: new Headers(target.headers),
                body: HttpBody.jsonUnsafe({ patch: sourcePatch }),
              }),
            fallback: { applied: false },
          }).pipe(Effect.provide(AppNodeBuilderV1.build(InstanceStore.node)))
        }

        if (input.workspaceID === null) {
          yield* session.setWorkspace({ sessionID: input.sessionID, workspaceID: undefined })

          return
        }

        const workspaceID = input.workspaceID
        const space = yield* get(workspaceID)
        if (!space)
          return yield* new WorkspaceNotFoundError({
            message: `Workspace not found: ${workspaceID}`,
            workspaceID,
          })

        const target = yield* WorkspaceAdapterRuntime.target(space)

        if (target.type === "local") {
          yield* session.setWorkspace({ sessionID: input.sessionID, workspaceID: input.workspaceID })

          return
        }

        const rows = yield* db
          .select({
            id: EventTable.id,
            aggregateID: EventTable.aggregate_id,
            seq: EventTable.seq,
            type: EventTable.type,
            data: EventTable.data,
          })
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, input.sessionID))
          .orderBy(asc(EventTable.seq))
          .all()
          .pipe(Effect.orDie)
        if (rows.length === 0)
          return yield* new SessionEventsNotFoundError({
            message: `No events found for session: ${input.sessionID}`,
            sessionID: input.sessionID,
          })

        const batches = Iterable.chunksOf(rows, 10)
        const total = Iterable.size(batches)

        yield* Effect.forEach(
          batches,
          (events, i) =>
            Effect.gen(function* () {
              const response = yield* http.execute(
                HttpClientRequest.post(route(target.url, "/sync/replay"), {
                  headers: new Headers(target.headers),
                  body: HttpBody.jsonUnsafe({
                    directory: space.directory ?? "",
                    events,
                  }),
                }),
              )

              if (response.status < 200 || response.status >= 300) {
                const body = yield* response.text
                return yield* new SessionWarpHttpError({
                  message: `Failed to warp session ${input.sessionID} into workspace ${workspaceID}: HTTP ${response.status} ${body}`,
                  workspaceID,
                  sessionID: input.sessionID,
                  status: response.status,
                  body,
                })
              }
            }),
          { discard: true },
        )

        const response = yield* http.execute(
          HttpClientRequest.post(route(target.url, "/sync/steal"), {
            headers: new Headers(target.headers),
            body: HttpBody.jsonUnsafe({ sessionID: input.sessionID }),
          }),
        )
        if (response.status < 200 || response.status >= 300) {
          const body = yield* response.text
          return yield* new SessionWarpHttpError({
            message: `Failed to steal session ${input.sessionID} into workspace ${workspaceID}: HTTP ${response.status} ${body}`,
            workspaceID,
            sessionID: input.sessionID,
            status: response.status,
            body,
          })
        }

        yield* session.setWorkspace({ sessionID: input.sessionID, workspaceID: input.workspaceID })
      })
    })

    const list = Effect.fn("Workspace.list")(function* (project: Project.Info) {
      return (yield* db
        .select()
        .from(WorkspaceTable)
        .where(eq(WorkspaceTable.project_id, project.id))
        .all()
        .pipe(Effect.orDie))
        .map(fromRow)
        .sort((a, b) => a.id.localeCompare(b.id))
    })

    const syncList = Effect.fn("Workspace.syncList")(function* (project: Project.Info) {
      const names = new Set((yield* list(project)).map((workspace) => workspace.name))
      const discovered = yield* Effect.forEach(
        registeredAdapters(project.id),
        ([type, adapter]) =>
          WorkspaceAdapterRuntime.list(adapter).pipe(
            Effect.catchCause((error) =>
              Effect.logWarning("workspace adapter list failed", { type, error }).pipe(Effect.as([])),
            ),
          ),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((items) => items.flat()))

      yield* Effect.forEach(
        discovered,
        (item) =>
          Effect.gen(function* () {
            if (names.has(item.name)) return
            names.add(item.name)

            const info: Info = {
              id: WorkspaceV2.ID.ascending(),
              type: item.type,
              branch: item.branch,
              name: item.name,
              directory: item.directory,
              extra: item.extra,
              projectID: item.projectID,
              timeUsed: Date.now(),
            }

            yield* db
              .insert(WorkspaceTable)
              .values({
                id: info.id,
                type: info.type,
                branch: info.branch,
                name: info.name,
                directory: info.directory,
                extra: info.extra,
                project_id: info.projectID,
                time_used: info.timeUsed,
              })
              .run()
              .pipe(Effect.orDie)

            yield* startSync(info)
          }),
        { concurrency: 1 },
      )
    })

    const get = Effect.fn("Workspace.get")(function* (id: WorkspaceV2.ID) {
      const row = yield* db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id)).get().pipe(Effect.orDie)
      if (!row) return
      return fromRow(row)
    })

    const remove = Effect.fn("Workspace.remove")(function* (id: WorkspaceV2.ID) {
      const sessions = yield* db
        .select({ id: SessionTable.id, parentID: SessionTable.parent_id })
        .from(SessionTable)
        .where(eq(SessionTable.workspace_id, id))
        .all()
        .pipe(Effect.orDie)
      const sessionIDs = new Set(sessions.map((sessionInfo) => sessionInfo.id))
      yield* Effect.forEach(
        sessions.filter((sessionInfo) => !sessionInfo.parentID || !sessionIDs.has(sessionInfo.parentID)),
        (sessionInfo) =>
          session.remove(sessionInfo.id).pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.void)),
        { discard: true },
      )

      const row = yield* db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id)).get().pipe(Effect.orDie)
      if (!row) return

      yield* stopSync(id)

      const info = fromRow(row)
      yield* Effect.catchCause(
        Effect.gen(function* () {
          yield* WorkspaceAdapterRuntime.remove(info)
        }),
        () => Effect.logError("adapter not available when removing workspace", { type: row.type }),
      )

      yield* db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, id)).run().pipe(Effect.orDie)
      return info
    })

    const status = Effect.fn("Workspace.status")(function* () {
      return [...connections.values()]
    })

    const isSyncing = Effect.fn("Workspace.isSyncing")(function* (workspaceID: WorkspaceV2.ID) {
      const exists = yield* FiberMap.has(syncFibers, workspaceID)
      return exists && connections.get(workspaceID)?.status !== "error"
    })

    const waitForSync = Effect.fn("Workspace.waitForSync")(function* (
      workspaceID: WorkspaceV2.ID,
      state: Record<string, number>,
      signal?: AbortSignal,
      timeout = TIMEOUT,
    ) {
      if (yield* synced(db, state)) return

      yield* Effect.catch(
        waitUntilSynced({ db, workspaceID, state, signal, timeout }),
        (): Effect.Effect<never, WaitForSyncError> =>
          signal?.aborted
            ? Effect.fail(
                new SyncAbortedError({
                  message: signal.reason instanceof Error ? signal.reason.message : "Request aborted",
                  cause: signal.reason,
                }),
              )
            : Effect.fail(
                new SyncTimeoutError({
                  message: `Timed out waiting for sync fence: ${JSON.stringify(state)}`,
                  state,
                }),
              ),
      )
    })

    const startWorkspaceSyncing = Effect.fn("Workspace.startWorkspaceSyncing")(function* (projectID: ProjectV2.ID) {
      const rows = yield* db
        .selectDistinct({ workspace: WorkspaceTable })
        .from(WorkspaceTable)
        .where(eq(WorkspaceTable.project_id, projectID))
        .all()
        .pipe(Effect.orDie)

      for (const { workspace } of rows) {
        yield* startSync(fromRow(workspace)).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              setStatus(workspace.id, "error")
            }),
          ),
          Effect.forkDetach,
        )
      }
    })

    return Service.of({
      create,
      sessionWarp,
      list,
      syncList,
      get,
      remove,
      status,
      isSyncing,
      waitForSync,
      startWorkspaceSyncing,
    })
  }),
)

const TIMEOUT = 5000

type HistoryEvent = {
  id: string
  aggregate_id: string
  seq: number
  type: string
  data: Record<string, unknown>
}

function waitUntilSynced(input: {
  db: Database.Interface["db"]
  workspaceID: WorkspaceV2.ID
  state: Record<string, number>
  signal?: AbortSignal
  timeout: number
}): Effect.Effect<void, unknown> {
  return Effect.suspend(() =>
    waitEvent({
      timeout: input.timeout,
      signal: input.signal,
      fn(event) {
        return event.workspace === input.workspaceID || event.payload.type === "sync"
      },
    }).pipe(
      Effect.andThen(synced(input.db, input.state)),
      Effect.flatMap((done): Effect.Effect<void, unknown> => (done ? Effect.void : waitUntilSynced(input))),
    ),
  )
}

function synced(db: Database.Interface["db"], state: Record<string, number>): Effect.Effect<boolean> {
  const ids = Object.keys(state)
  if (ids.length === 0) return Effect.succeed(true)

  return db
    .select({
      id: EventSequenceTable.aggregate_id,
      seq: EventSequenceTable.seq,
    })
    .from(EventSequenceTable)
    .where(inArray(EventSequenceTable.aggregate_id, ids))
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => {
        const done = Object.fromEntries(rows.map((row) => [row.id, row.seq])) as Record<string, number>
        return ids.every((id) => (done[id] ?? -1) >= state[id])
      }),
    )
}

function route(url: string | URL, path: string) {
  const next = new URL(url)
  next.pathname = `${next.pathname.replace(/\/$/, "")}${path}`
  next.search = ""
  next.hash = ""
  return next
}

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    Auth.node,
    Session.node,
    SessionPrompt.node,
    httpClient,
    EventV2Bridge.node,
    Vcs.node,
    RuntimeFlags.node,
    FSUtil.node,
    Database.node,
  ],
})

export * as Workspace from "./workspace"
