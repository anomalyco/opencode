import { Context, Effect, FiberMap, Iterable, Layer, Schema, Stream } from "effect"
import { FetchHttpClient, HttpBody, HttpClient, HttpClientError, HttpClientRequest } from "effect/unstable/http"
import { Database } from "@/storage/db"
import { asc } from "drizzle-orm"
import { eq } from "drizzle-orm"
import { inArray } from "drizzle-orm"
import { Project } from "@/project/project"
import { Instance } from "@/project/instance"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Auth } from "@/auth"
import { SyncEvent } from "@/sync"
import { EventSequenceTable, EventTable } from "@/sync/event.sql"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { Filesystem } from "@/util/filesystem"
import { ProjectID } from "@/project/schema"
import { Slug } from "@opencode-ai/core/util/slug"
import { WorkspaceTable } from "./workspace.sql"
import { getAdapter } from "./adapters"
import { type WorkspaceInfo, WorkspaceInfo as WorkspaceInfoSchema } from "./types"
import { WorkspaceID } from "./schema"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionTable } from "@/session/session.sql"
import { SessionID } from "@/session/schema"
import { errorData } from "@/util/error"
import { waitEvent } from "./util"
import { WorkspaceContext } from "./workspace-context"
import { EffectBridge } from "@/effect/bridge"
import { NonNegativeInt, withStatics } from "@/util/schema"
import { zod as effectZod, zodObject } from "@/util/effect-zod"

export const Info = WorkspaceInfoSchema
export type Info = WorkspaceInfo

export const ConnectionStatus = Schema.Struct({
  workspaceID: WorkspaceID,
  status: Schema.Literals(["connected", "connecting", "disconnected", "error"]),
})
export type ConnectionStatus = Schema.Schema.Type<typeof ConnectionStatus>

export const Event = {
  Ready: BusEvent.define(
    "workspace.ready",
    Schema.Struct({
      name: Schema.String,
    }),
  ),
  Failed: BusEvent.define(
    "workspace.failed",
    Schema.Struct({
      message: Schema.String,
    }),
  ),
  Status: BusEvent.define("workspace.status", ConnectionStatus),
}

function fromRow(row: typeof WorkspaceTable.$inferSelect): Info {
  return {
    id: row.id,
    type: row.type,
    branch: row.branch,
    name: row.name,
    directory: row.directory,
    extra: row.extra,
    projectID: row.project_id,
  }
}

const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
  Effect.sync(() => Database.use(fn))

const log = Log.create({ service: "workspace-sync" })

export const CreateInput = Schema.Struct({
  id: Schema.optional(WorkspaceID),
  type: Info.fields.type,
  branch: Info.fields.branch,
  projectID: ProjectID,
  extra: Schema.optional(Info.fields.extra),
}).pipe(withStatics((s) => ({ zod: effectZod(s), zodObject: zodObject(s) })))
export type CreateInput = Schema.Schema.Type<typeof CreateInput>

export const SessionWarpInput = Schema.Struct({
  workspaceID: Schema.NullOr(WorkspaceID),
  sessionID: SessionID,
}).pipe(withStatics((s) => ({ zod: effectZod(s), zodObject: zodObject(s) })))
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
    workspaceID: WorkspaceID,
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
    workspaceID: WorkspaceID,
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
  cause: Schema.optional(Schema.Defect),
}) {}

type CreateError = Auth.AuthError
type SessionWarpError =
  | WorkspaceNotFoundError
  | SessionEventsNotFoundError
  | SessionWarpHttpError
  | HttpClientError.HttpClientError
type WaitForSyncError = SyncTimeoutError | SyncAbortedError
type SyncLoopError = SyncHttpError | HttpClientError.HttpClientError

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info, CreateError>
  readonly sessionWarp: (input: SessionWarpInput) => Effect.Effect<void, SessionWarpError>
  readonly list: (project: Project.Info) => Effect.Effect<Info[]>
  readonly get: (id: WorkspaceID) => Effect.Effect<Info | undefined>
  readonly remove: (id: WorkspaceID) => Effect.Effect<Info | undefined>
  readonly status: () => Effect.Effect<ConnectionStatus[]>
  readonly isSyncing: (workspaceID: WorkspaceID) => Effect.Effect<boolean>
  readonly waitForSync: (
    workspaceID: WorkspaceID,
    state: Record<string, number>,
    signal?: AbortSignal,
  ) => Effect.Effect<void, WaitForSyncError>
  readonly startWorkspaceSyncing: (projectID: ProjectID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Workspace") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const session = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const http = yield* HttpClient.HttpClient
    const sync = yield* SyncEvent.Service
    const connections = new Map<WorkspaceID, ConnectionStatus>()
    const syncFibers = yield* FiberMap.make<WorkspaceID, void, SyncLoopError>()

    const setStatus = (id: WorkspaceID, status: ConnectionStatus["status"]) => {
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

    const syncHistory = Effect.fn("Workspace.syncHistory")(function* (
      space: Info,
      url: URL | string,
      headers: HeadersInit | undefined,
    ) {
      const sessionIDs = yield* db((db) =>
        db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(eq(SessionTable.workspace_id, space.id))
          .all()
          .map((row) => row.id),
      )
      const state = sessionIDs.length
        ? Object.fromEntries(
            (yield* db((db) =>
              db.select().from(EventSequenceTable).where(inArray(EventSequenceTable.aggregate_id, sessionIDs)).all(),
            )).map((row) => [row.aggregate_id, row.seq]),
          )
        : {}

      log.info("syncing workspace history", {
        workspaceID: space.id,
        sessions: sessionIDs.length,
        known: Object.keys(state).length,
      })

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

      const events = (yield* response.json) as HistoryEvent[]

      log.info("workspace history synced", {
        workspaceID: space.id,
        events: events.length,
      })

      yield* Effect.promise(async () => {
        await WorkspaceContext.provide({
          workspaceID: space.id,
          async fn() {
            await Effect.runPromise(
              Effect.forEach(
                events,
                (event) =>
                  sync.replay(
                    {
                      id: event.id,
                      aggregateID: event.aggregate_id,
                      seq: event.seq,
                      type: event.type,
                      data: event.data,
                    },
                    { publish: true },
                  ),
                { discard: true },
              ),
            )
          },
        })
      })
    })

    const syncWorkspaceLoop = Effect.fn("Workspace.syncWorkspaceLoop")(function* (space: Info) {
      const adapter = getAdapter(space.projectID, space.type)
      const target = yield* EffectBridge.fromPromise(() => adapter.target(space))

      if (target.type === "local") return

      let attempt = 0

      while (true) {
        log.info("connecting to global sync", { workspace: space.name })
        setStatus(space.id, "connecting")

        const stream = yield* connectSSE(target.url, target.headers).pipe(
          Effect.tap(() => syncHistory(space, target.url, target.headers)),
          Effect.catch((err) =>
            Effect.sync(() => {
              setStatus(space.id, "error")
              log.info("failed to connect to global sync", {
                workspace: space.name,
                err,
              })
              return null
            }),
          ),
        )

        if (stream) {
          attempt = 0

          log.info("global sync connected", { workspace: space.name })
          setStatus(space.id, "connected")

          yield* parseSSE(stream, (evt) =>
            Effect.gen(function* () {
              if (!evt || typeof evt !== "object" || !("payload" in evt)) return
              const payload = evt.payload as { type?: string; syncEvent?: SyncEvent.SerializedEvent }
              if (payload.type === "server.heartbeat") return

              if (payload.type === "sync" && payload.syncEvent) {
                const failed = yield* sync.replay(payload.syncEvent).pipe(
                  Effect.as(false),
                  Effect.catchCause((error) =>
                    Effect.sync(() => {
                      log.info("failed to replay global event", {
                        workspaceID: space.id,
                        error,
                      })
                      return true
                    }),
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
                log.info("failed to replay global event", {
                  workspaceID: space.id,
                  error,
                })
              }
            }),
          )

          log.info("disconnected from global sync: " + space.id)
          setStatus(space.id, "disconnected")
        }

        // Back off reconnect attempts up to 2 minutes while the workspace
        // stays unavailable.
        yield* Effect.sleep(`${Math.min(120_000, 1_000 * 2 ** attempt)} millis`)
        attempt += 1
      }
    })

    const startSync = Effect.fn("Workspace.startSync")(function* (space: Info) {
      if (!Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) return

      const adapter = getAdapter(space.projectID, space.type)
      const target = yield* EffectBridge.fromPromise(() => adapter.target(space))

      if (target.type === "local") {
        setStatus(space.id, (yield* Effect.promise(() => Filesystem.exists(target.directory))) ? "connected" : "error")
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
            Effect.sync(() => {
              setStatus(space.id, "error")
              log.warn("workspace listener failed", {
                workspaceID: space.id,
                error,
              })
            }),
          ),
        ),
      )
    })

    const stopSync = Effect.fn("Workspace.stopSync")(function* (id: WorkspaceID) {
      yield* FiberMap.remove(syncFibers, id)
      connections.delete(id)
    })

    const create = Effect.fn("Workspace.create")(function* (input: CreateInput) {
      const id = WorkspaceID.ascending(input.id)
      const adapter = getAdapter(input.projectID, input.type)
      const config = yield* EffectBridge.fromPromise(() =>
        adapter.configure({ ...input, id, name: Slug.create(), directory: null, extra: input.extra ?? null }),
      )

      const info: Info = {
        id,
        type: config.type,
        branch: config.branch ?? null,
        name: config.name ?? null,
        directory: config.directory ?? null,
        extra: config.extra ?? null,
        projectID: input.projectID,
      }

      yield* db((db) => {
        db.insert(WorkspaceTable)
          .values({
            id: info.id,
            type: info.type,
            branch: info.branch,
            name: info.name,
            directory: info.directory,
            extra: info.extra,
            project_id: info.projectID,
          })
          .run()
      })

      const env = {
        OPENCODE_AUTH_CONTENT: JSON.stringify(yield* auth.all()),
        OPENCODE_WORKSPACE_ID: config.id,
        OPENCODE_EXPERIMENTAL_WORKSPACES: "true",
        OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS,
        OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        OTEL_RESOURCE_ATTRIBUTES: process.env.OTEL_RESOURCE_ATTRIBUTES,
      }

      yield* EffectBridge.fromPromise(() => adapter.create(config, env))
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
        log.info("session warp requested", {
          workspaceID: input.workspaceID,
          sessionID: input.sessionID,
        })

        const current = yield* db((db) =>
          db
            .select({ workspaceID: SessionTable.workspace_id })
            .from(SessionTable)
            .where(eq(SessionTable.id, input.sessionID))
            .get(),
        )

        if (current?.workspaceID) {
          const previous = yield* get(current.workspaceID)
          if (previous) {
            const adapter = getAdapter(previous.projectID, previous.type)
            const target = yield* EffectBridge.fromPromise(() => adapter.target(previous))

            if (target.type === "remote") {
              yield* syncHistory(previous, target.url, target.headers).pipe(
                Effect.catch((error) =>
                  Effect.sync(() => {
                    log.warn("session warp final source sync failed", {
                      workspaceID: previous.id,
                      sessionID: input.sessionID,
                      error: errorData(error),
                    })
                  }),
                ),
              )
            } else {
              yield* prompt.cancel(input.sessionID)
            }

            // "claim" this session so any future events coming from
            // the old workspace are ignored
            SyncEvent.claim(input.sessionID, input.workspaceID ?? Instance.project.id)
          }
        }

        if (input.workspaceID === null) {
          yield* Effect.sync(() =>
            SyncEvent.run(Session.Event.Updated, {
              sessionID: input.sessionID,
              info: {
                workspaceID: null,
              },
            }),
          )

          log.info("session warp complete", {
            workspaceID: input.workspaceID,
            sessionID: input.sessionID,
            target: "local",
          })
          return
        }

        const workspaceID = input.workspaceID
        const space = yield* get(workspaceID)
        if (!space)
          return yield* new WorkspaceNotFoundError({
            message: `Workspace not found: ${workspaceID}`,
            workspaceID,
          })

        const adapter = getAdapter(space.projectID, space.type)
        const target = yield* EffectBridge.fromPromise(() => adapter.target(space))

        if (target.type === "local") {
          yield* sync.run(Session.Event.Updated, {
            sessionID: input.sessionID,
            info: {
              workspaceID: input.workspaceID,
            },
          })

          log.info("session warp complete", {
            workspaceID: input.workspaceID,
            sessionID: input.sessionID,
            target: target.directory,
          })
          return
        }

        const rows = yield* db((db) =>
          db
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
            .all(),
        )
        if (rows.length === 0)
          return yield* new SessionEventsNotFoundError({
            message: `No events found for session: ${input.sessionID}`,
            sessionID: input.sessionID,
          })

        const batches = Iterable.chunksOf(rows, 10)
        const total = Iterable.size(batches)

        log.info("session warp prepared", {
          workspaceID: input.workspaceID,
          sessionID: input.sessionID,
          target: String(route(target.url, "/sync/replay")),
          events: rows.length,
          batches: total,
          first: rows[0]?.seq,
          last: rows.at(-1)?.seq,
        })

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
                log.error("session warp batch failed", {
                  workspaceID: input.workspaceID,
                  sessionID: input.sessionID,
                  step: i + 1,
                  total,
                  status: response.status,
                  body,
                })
                return yield* new SessionWarpHttpError({
                  message: `Failed to warp session ${input.sessionID} into workspace ${workspaceID}: HTTP ${response.status} ${body}`,
                  workspaceID,
                  sessionID: input.sessionID,
                  status: response.status,
                  body,
                })
              }

              log.info("session warp batch posted", {
                workspaceID: input.workspaceID,
                sessionID: input.sessionID,
                step: i + 1,
                total,
                status: response.status,
              })
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
          log.error("session warp steal failed", {
            workspaceID: input.workspaceID,
            sessionID: input.sessionID,
            status: response.status,
            body,
          })
          return yield* new SessionWarpHttpError({
            message: `Failed to steal session ${input.sessionID} into workspace ${workspaceID}: HTTP ${response.status} ${body}`,
            workspaceID,
            sessionID: input.sessionID,
            status: response.status,
            body,
          })
        }

        log.info("session warp complete", {
          workspaceID: input.workspaceID,
          sessionID: input.sessionID,
          batches: total,
        })
      }).pipe(
        Effect.tapError((err) =>
          Effect.sync(() =>
            log.error("session warp failed", {
              workspaceID: input.workspaceID,
              sessionID: input.sessionID,
              error: errorData(err),
            }),
          ),
        ),
      )
    })

    const list = Effect.fn("Workspace.list")(function* (project: Project.Info) {
      return yield* db((db) =>
        db
          .select()
          .from(WorkspaceTable)
          .where(eq(WorkspaceTable.project_id, project.id))
          .all()
          .map(fromRow)
          .sort((a, b) => a.id.localeCompare(b.id)),
      )
    })

    const get = Effect.fn("Workspace.get")(function* (id: WorkspaceID) {
      const row = yield* db((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id)).get())
      if (!row) return
      return fromRow(row)
    })

    const remove = Effect.fn("Workspace.remove")(function* (id: WorkspaceID) {
      const sessions = yield* db((db) =>
        db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.workspace_id, id)).all(),
      )
      yield* Effect.forEach(sessions, (sessionInfo) => session.remove(sessionInfo.id), { discard: true })

      const row = yield* db((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id)).get())
      if (!row) return

      yield* stopSync(id)

      const info = fromRow(row)
      yield* Effect.catchCause(
        Effect.gen(function* () {
          const adapter = getAdapter(info.projectID, row.type)
          yield* EffectBridge.fromPromise(() => adapter.remove(info))
        }),
        () =>
          Effect.sync(() => {
            log.error("adapter not available when removing workspace", { type: row.type })
          }),
      )

      yield* db((db) => db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, id)).run())
      return info
    })

    const status = Effect.fn("Workspace.status")(function* () {
      return [...connections.values()]
    })

    const isSyncing = Effect.fn("Workspace.isSyncing")(function* (workspaceID: WorkspaceID) {
      const exists = yield* FiberMap.has(syncFibers, workspaceID)
      return exists && connections.get(workspaceID)?.status !== "error"
    })

    const waitForSync = Effect.fn("Workspace.waitForSync")(function* (
      workspaceID: WorkspaceID,
      state: Record<string, number>,
      signal?: AbortSignal,
    ) {
      if (synced(state)) return

      yield* Effect.catch(
        waitEvent({
          timeout: TIMEOUT,
          signal,
          fn(event) {
            if (event.workspace !== workspaceID && event.payload.type !== "sync") {
              return false
            }
            return synced(state)
          },
        }),
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

    const startWorkspaceSyncing = Effect.fn("Workspace.startWorkspaceSyncing")(function* (projectID: ProjectID) {
      // This session table join makes this query only return
      // workspaces that have sessions
      const rows = yield* db((db) =>
        db
          .selectDistinct({ workspace: WorkspaceTable })
          .from(WorkspaceTable)
          .innerJoin(SessionTable, eq(SessionTable.workspace_id, WorkspaceTable.id))
          .where(eq(WorkspaceTable.project_id, projectID))
          .all(),
      )

      for (const { workspace } of rows) {
        yield* startSync(fromRow(workspace)).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              setStatus(workspace.id, "error")
              log.warn("workspace sync failed to start", {
                workspaceID: workspace.id,
                error,
              })
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
      get,
      remove,
      status,
      isSyncing,
      waitForSync,
      startWorkspaceSyncing,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(SyncEvent.defaultLayer),
  Layer.provide(SessionPrompt.defaultLayer),
  Layer.provide(FetchHttpClient.layer),
)

const TIMEOUT = 5000

type HistoryEvent = {
  id: string
  aggregate_id: string
  seq: number
  type: string
  data: Record<string, unknown>
}

function synced(state: Record<string, number>) {
  const ids = Object.keys(state)
  if (ids.length === 0) return true

  const done = Object.fromEntries(
    Database.use((db) =>
      db
        .select({
          id: EventSequenceTable.aggregate_id,
          seq: EventSequenceTable.seq,
        })
        .from(EventSequenceTable)
        .where(inArray(EventSequenceTable.aggregate_id, ids))
        .all(),
    ).map((row) => [row.id, row.seq]),
  ) as Record<string, number>

  return ids.every((id) => {
    return (done[id] ?? -1) >= state[id]
  })
}

function route(url: string | URL, path: string) {
  const next = new URL(url)
  next.pathname = `${next.pathname.replace(/\/$/, "")}${path}`
  next.search = ""
  next.hash = ""
  return next
}

export * as Workspace from "./workspace"
