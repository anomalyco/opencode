export * as SessionV2 from "./session"
export * from "./session/schema"

import { DateTime, Effect, Layer, Schema, Context, Stream } from "effect"
import { ListAnchor } from "@opencode-ai/schema/session"
import { and, asc, desc, eq, gt, like, lt, lte, or, type SQL } from "drizzle-orm"
import { ProjectV2 } from "./project"
import { WorkspaceV2 } from "./workspace"
import { ModelV2 } from "./model"
import { Location } from "./location"
import { SessionMessage } from "./session/message"
import { Prompt } from "./session/prompt"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { EventV2 } from "./event"
import { Database } from "./database/database"
import { SessionProjector } from "./session/projector"
import { SessionMessageTable, SessionTable } from "./session/sql"
import { SessionSchema } from "./session/schema"
import { AbsolutePath, PositiveInt, RelativePath } from "./schema"
import { AgentV2 } from "./agent"
import { SessionV1 } from "./v1/session"
import { InstallationVersion } from "./installation/version"
import { Slug } from "./util/slug"
import { ProjectTable } from "./project/sql"
import path from "path"
import { fromRow } from "./session/info"
import { SessionRunner } from "./session/runner/index"
import { SessionStore } from "./session/store"
import { SessionExecution } from "./session/execution"
import { makeGlobalNode } from "./effect/app-node"
import { LocationServiceMap } from "./location-service-map"
import { MessageDecodeError } from "./session/error"
import { SessionEvent } from "./session/event"
import { SessionInput } from "./session/input"
import { Snapshot } from "./snapshot"
import { SessionRevert } from "./session/revert"
import { Revert } from "@opencode-ai/schema/revert"
import { FSUtil } from "./fs-util"
import { SessionDurable } from "@opencode-ai/schema/durable-event-manifest"

export const RevertState = Revert.State
export type RevertState = Revert.State

// get project -> project.locations
//
// get all sessions
//

// - by project
//   - by subpath
// - by workspace (home is special)

export { ListAnchor }

const ListInputBase = {
  workspaceID: WorkspaceV2.ID.pipe(Schema.optional),
  search: Schema.String.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
  order: Schema.Literals(["asc", "desc"]).pipe(Schema.optional),
  anchor: ListAnchor.pipe(Schema.optional),
}

const ListDirectoryInput = Schema.Struct({
  ...ListInputBase,
  directory: AbsolutePath,
})

const ListProjectInput = Schema.Struct({
  ...ListInputBase,
  project: ProjectV2.ID,
  subpath: RelativePath.pipe(Schema.optional),
})

const ListAllInput = Schema.Struct(ListInputBase)

export const ListInput = Schema.Union([ListDirectoryInput, ListProjectInput, ListAllInput])
export type ListInput = typeof ListInput.Type

type CreateInput = {
  id?: SessionSchema.ID
  agent?: AgentV2.ID
  model?: ModelV2.Ref
  location: Location.Ref
}

type CompactInput = {
  sessionID: SessionSchema.ID
  prompt?: Prompt
}

type MessagesInput = {
  sessionID: SessionSchema.ID
  limit?: number
  order?: "asc" | "desc"
  cursor?: ({ seq: number } | { id: SessionMessage.ID }) & { direction: "previous" | "next" }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Session.NotFoundError", {
  sessionID: SessionSchema.ID,
}) {}

export class OperationUnavailableError extends Schema.TaggedErrorClass<OperationUnavailableError>()(
  "Session.OperationUnavailableError",
  {
    operation: Schema.Literals(["move", "shell", "skill", "switchAgent", "compact", "wait"]),
  },
) {}

export { ContextSnapshotDecodeError, MessageDecodeError } from "./session/error"

export class PromptConflictError extends Schema.TaggedErrorClass<PromptConflictError>()("Session.PromptConflictError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {}
export const MessageNotFoundError = SessionRevert.MessageNotFoundError
export type MessageNotFoundError = SessionRevert.MessageNotFoundError

export type Error = NotFoundError | MessageDecodeError | OperationUnavailableError | PromptConflictError

export interface Interface {
  readonly list: (input?: ListInput) => Effect.Effect<SessionSchema.Info[]>
  readonly create: (input: CreateInput) => Effect.Effect<SessionSchema.Info>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info, NotFoundError>
  readonly messages: (
    input: MessagesInput,
  ) => Effect.Effect<SessionMessage.Message[], NotFoundError | MessageNotFoundError | MessageDecodeError>
  readonly messagePage: (input: MessagesInput & { includeRevert?: boolean }) => Effect.Effect<
    {
      data: SessionMessage.Message[]
      context: SessionMessage.Message[]
      sequence: Map<string, number>
      cursor: {
        previous?: number
        next?: number
      }
      revert?: Revert.Preview
    },
    NotFoundError | MessageNotFoundError | MessageDecodeError
  >
  readonly message: (input: {
    sessionID: SessionSchema.ID
    messageID: SessionMessage.ID
  }) => Effect.Effect<SessionMessage.Message | undefined>
  readonly context: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<SessionMessage.Message[], NotFoundError | MessageDecodeError>
  readonly events: (input: {
    sessionID: SessionSchema.ID
    after?: number
  }) => Stream.Stream<SessionEvent.DurableEvent, NotFoundError>
  readonly history: (input: {
    sessionID: SessionSchema.ID
    after?: number
    limit: number
  }) => Effect.Effect<{ events: ReadonlyArray<SessionEvent.DurableEvent>; hasMore: boolean }, NotFoundError>
  readonly switchAgent: (input: { sessionID: SessionSchema.ID; agent: string }) => Effect.Effect<void, NotFoundError>
  readonly switchModel: (input: {
    sessionID: SessionSchema.ID
    model: ModelV2.Ref
  }) => Effect.Effect<void, NotFoundError>
  readonly prompt: (input: {
    id?: SessionMessage.ID
    sessionID: SessionSchema.ID
    prompt: PromptInput.Prompt
    delivery?: SessionInput.Delivery
    resume?: boolean
  }) => Effect.Effect<SessionInput.Admitted, NotFoundError | PromptConflictError>
  readonly shell: (input: {
    id?: EventV2.ID
    sessionID: SessionSchema.ID
    command: string
    resume?: boolean
  }) => Effect.Effect<void, OperationUnavailableError>
  readonly skill: (input: {
    id?: EventV2.ID
    sessionID: SessionSchema.ID
    skill: string
    resume?: boolean
  }) => Effect.Effect<void, OperationUnavailableError>
  readonly compact: (input: CompactInput) => Effect.Effect<void, NotFoundError | OperationUnavailableError>
  readonly wait: (id: SessionSchema.ID) => Effect.Effect<void, NotFoundError | OperationUnavailableError>
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError | SessionRunner.RunError>
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly revert: {
    readonly stage: (input: {
      sessionID: SessionSchema.ID
      messageID: SessionMessage.ID
      files?: boolean
    }) => Effect.Effect<Revert.State, NotFoundError | MessageNotFoundError | Snapshot.Error>
    readonly clear: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError | Snapshot.Error>
    readonly commit: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError>
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Session") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db
    const events = yield* EventV2.Service
    const projects = yield* ProjectV2.Service
    const execution = yield* SessionExecution.Service
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const decodeMessage = Schema.decodeUnknownEffect(SessionMessage.Message)
    const isDurableSessionEvent = Schema.is(SessionEvent.Durable)
    const decode = (row: typeof SessionMessageTable.$inferSelect) =>
      decodeMessage({ ...row.data, id: row.id, type: row.type }).pipe(
        Effect.mapError(
          () =>
            new MessageDecodeError({
              sessionID: SessionSchema.ID.make(row.session_id),
              messageID: SessionMessage.ID.make(row.id),
            }),
        ),
      )
    const messageRows = Effect.fn("V2Session.messages.rows")(function* (input: MessagesInput) {
      const direction = input.cursor?.direction ?? "next"
      const requestedOrder = input.order ?? "desc"
      const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
      const anchor = input.cursor
        ? "seq" in input.cursor
          ? { seq: input.cursor.seq }
          : yield* db
              .select({ seq: SessionMessageTable.seq })
              .from(SessionMessageTable)
              .where(
                and(eq(SessionMessageTable.session_id, input.sessionID), eq(SessionMessageTable.id, input.cursor.id)),
              )
              .get()
              .pipe(Effect.orDie)
        : undefined
      if (input.cursor && "id" in input.cursor && !anchor)
        return yield* new MessageNotFoundError({ sessionID: input.sessionID, messageID: input.cursor.id })
      const boundary = anchor
        ? order === "asc"
          ? gt(SessionMessageTable.seq, anchor.seq)
          : lt(SessionMessageTable.seq, anchor.seq)
        : undefined
      const query = db
        .select()
        .from(SessionMessageTable)
        .where(
          boundary
            ? and(eq(SessionMessageTable.session_id, input.sessionID), boundary)
            : eq(SessionMessageTable.session_id, input.sessionID),
        )
        .orderBy(order === "asc" ? asc(SessionMessageTable.seq) : desc(SessionMessageTable.seq))
      const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit + 1).all()).pipe(
        Effect.orDie,
      )
      const overflow = input.limit !== undefined && rows.length > input.limit
      const page = overflow ? rows.slice(0, input.limit) : rows
      const ordered = direction === "previous" ? page.toReversed() : page
      const oppositeEdge = input.cursor
        ? ((direction === "previous" ? ordered.at(-1)?.seq : ordered[0]?.seq) ?? anchor?.seq)
        : undefined
      const oppositeBoundary =
        oppositeEdge !== undefined
          ? direction === "previous"
            ? requestedOrder === "asc"
              ? gt(SessionMessageTable.seq, oppositeEdge)
              : lt(SessionMessageTable.seq, oppositeEdge)
            : requestedOrder === "asc"
              ? lt(SessionMessageTable.seq, oppositeEdge)
              : gt(SessionMessageTable.seq, oppositeEdge)
          : undefined
      const opposite = oppositeBoundary
        ? yield* db
            .select({ seq: SessionMessageTable.seq })
            .from(SessionMessageTable)
            .where(and(eq(SessionMessageTable.session_id, input.sessionID), oppositeBoundary))
            .limit(1)
            .get()
            .pipe(Effect.orDie)
        : undefined
      return {
        rows: ordered,
        cursor: {
          previous:
            direction === "previous" ? (overflow ? ordered[0]?.seq : undefined) : opposite ? oppositeEdge : undefined,
          next:
            direction === "previous"
              ? opposite
                ? oppositeEdge
                : undefined
              : overflow
                ? ordered.at(-1)?.seq
                : undefined,
        },
      }
    })
    const messagePageContext = Effect.fn("V2Session.messagePage.context")(function* (input: {
      sessionID: SessionSchema.ID
      data: SessionMessage.Message[]
      rows: (typeof SessionMessageTable.$inferSelect)[]
      order: "asc" | "desc"
      revert?: Revert.State
    }) {
      const chronological = input.order === "asc" ? input.data : input.data.toReversed()
      const chronologicalRows = input.order === "asc" ? input.rows : input.rows.toReversed()
      const anchor = chronologicalRows[0]
      if (!anchor) return { messages: [], rows: [] }
      const rows = new Map<SessionMessage.ID, typeof SessionMessageTable.$inferSelect>()
      const add = (row: typeof SessionMessageTable.$inferSelect | undefined) => {
        if (row) rows.set(row.id, row)
      }
      const latest = (condition: SQL) =>
        db
          .select()
          .from(SessionMessageTable)
          .where(
            and(
              eq(SessionMessageTable.session_id, input.sessionID),
              lt(SessionMessageTable.seq, anchor.seq),
              condition,
            ),
          )
          .orderBy(desc(SessionMessageTable.seq))
          .limit(1)
          .get()
          .pipe(Effect.orDie)

      add(yield* latest(eq(SessionMessageTable.type, "agent-switched")))
      add(yield* latest(eq(SessionMessageTable.type, "model-switched")))
      const boundary = chronological.find((message) => {
        if (message.type === "agent-switched" || message.type === "model-switched" || message.type === "system")
          return false
        if (message.type === "synthetic") return !!message.text.trim()
        return true
      })
      if (boundary?.type === "assistant" || boundary?.type === "compaction") {
        add(yield* latest(or(eq(SessionMessageTable.type, "user"), eq(SessionMessageTable.type, "synthetic"))!))
      }

      if (input.revert) {
        const revert = yield* db
          .select({ seq: SessionMessageTable.seq })
          .from(SessionMessageTable)
          .where(
            and(
              eq(SessionMessageTable.session_id, input.sessionID),
              eq(SessionMessageTable.id, input.revert.messageID),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (revert) {
          const recent = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.session_id, input.sessionID),
                revert.seq < anchor.seq
                  ? lte(SessionMessageTable.seq, revert.seq)
                  : lt(SessionMessageTable.seq, anchor.seq),
              ),
            )
            .orderBy(desc(SessionMessageTable.seq))
            .limit(20)
            .all()
            .pipe(Effect.orDie)
          recent.forEach(add)
          const prior = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.session_id, input.sessionID),
                lt(SessionMessageTable.seq, revert.seq),
                or(eq(SessionMessageTable.type, "user"), eq(SessionMessageTable.type, "synthetic")),
              ),
            )
            .orderBy(desc(SessionMessageTable.seq))
            .limit(1)
            .get()
            .pipe(Effect.orDie)
          if (prior && prior.seq < anchor.seq) add(prior)
        }
      }

      const sorted = [...rows.values()].sort((a, b) => a.seq - b.seq)
      return { messages: yield* Effect.forEach(sorted, decode), rows: sorted }
    })

    const result = Service.of({
      create: Effect.fn("V2Session.create")(function* (input) {
        const sessionID = input.id ?? SessionSchema.ID.create()
        const recorded = yield* store.get(sessionID)
        if (recorded) return recorded
        const project = yield* projects.resolve(input.location.directory)
        yield* db
          .insert(ProjectTable)
          .values({ id: project.id, worktree: project.directory, vcs: project.vcs?.type, sandboxes: [] })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        const now = Date.now()
        const info = SessionV1.SessionInfo.make({
          id: sessionID,
          slug: Slug.create(),
          version: InstallationVersion,
          projectID: project.id,
          directory: input.location.directory,
          path: path.relative(project.directory, input.location.directory).replaceAll("\\", "/"),
          workspaceID: input.location.workspaceID ? WorkspaceV2.ID.make(input.location.workspaceID) : undefined,
          title: `New session - ${new Date(now).toISOString()}`,
          agent: input.agent,
          model: input.model
            ? {
                id: ModelV2.ID.make(input.model.id),
                providerID: input.model.providerID,
                variant: input.model.variant,
              }
            : undefined,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: now, updated: now },
        })
        const projected = yield* events
          .publish(SessionV1.Event.Created, { sessionID, info }, { location: input.location })
          .pipe(
            Effect.as({ type: "created" } as const),
            Effect.catchDefect((defect) => {
              if (!(defect instanceof SessionProjector.SessionAlreadyProjected)) {
                return Effect.die(defect)
              }
              // Concurrent creation lost the projection race. The existing Session identity wins.
              return store
                .get(sessionID)
                .pipe(
                  Effect.flatMap((session) =>
                    session ? Effect.succeed({ type: "existing", session } as const) : Effect.die(defect),
                  ),
                )
            }),
          )
        if (projected.type === "existing") return projected.session
        // TODO: Restore recorded sessions onto replacement synchronized workspaces in a future API slice.
        return yield* result.get(sessionID).pipe(Effect.orDie)
      }),
      get: Effect.fn("V2Session.get")(function* (sessionID) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* new NotFoundError({ sessionID })
        return session
      }),
      list: Effect.fn("V2Session.list")(function* (input = {}) {
        const direction = input.anchor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
        const sortColumn = SessionTable.time_created
        const conditions: SQL[] = []
        if ("directory" in input) conditions.push(eq(SessionTable.directory, input.directory))
        if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
        if ("project" in input) conditions.push(eq(SessionTable.project_id, input.project))
        if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
        if (input.anchor) {
          conditions.push(
            order === "asc"
              ? or(
                  gt(sortColumn, input.anchor.time),
                  and(eq(sortColumn, input.anchor.time), gt(SessionTable.id, input.anchor.id)),
                )!
              : or(
                  lt(sortColumn, input.anchor.time),
                  and(eq(sortColumn, input.anchor.time), lt(SessionTable.id, input.anchor.id)),
                )!,
          )
        }
        const query = db
          .select()
          .from(SessionTable)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(
            order === "asc" ? asc(sortColumn) : desc(sortColumn),
            order === "asc" ? asc(SessionTable.id) : desc(SessionTable.id),
          )
        const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(
          Effect.orDie,
        )
        return (direction === "previous" ? rows.toReversed() : rows).map((row) => fromRow(row))
      }),
      messages: Effect.fn("V2Session.messages")(function* (input) {
        yield* result.get(input.sessionID)
        return yield* Effect.forEach((yield* messageRows(input)).rows, decode)
      }),
      messagePage: Effect.fn("V2Session.messagePage")(function* (input) {
        const session = yield* result.get(input.sessionID)
        const page = yield* messageRows(input)
        const rows = page.rows
        const data = yield* Effect.forEach(rows, decode)
        const order = input.order ?? "desc"
        const context = yield* messagePageContext({
          sessionID: input.sessionID,
          data,
          rows,
          order,
          revert: input.includeRevert ? session.revert : undefined,
        })
        const sequence = new Map([...rows, ...context.rows].map((row) => [row.id, row.seq] as const))
        return {
          data,
          context: context.messages,
          sequence,
          cursor: page.cursor,
          revert: input.includeRevert
            ? yield* SessionRevert.preview(session).pipe(Effect.provideService(Database.Service, database))
            : undefined,
        }
      }),
      message: Effect.fn("V2Session.message")(function* (input) {
        const stored = yield* store.message(input.messageID)
        return stored?.sessionID === input.sessionID ? stored.message : undefined
      }),
      context: Effect.fn("V2Session.context")(function* (sessionID) {
        yield* result.get(sessionID)
        return yield* store.context(sessionID)
      }),
      events: (input) =>
        Stream.unwrap(
          result
            .get(input.sessionID)
            .pipe(Effect.as(events.durable({ aggregateID: input.sessionID, after: input.after }))),
        ).pipe(Stream.filter((event): event is SessionEvent.DurableEvent => isDurableSessionEvent(event))),
      history: Effect.fn("V2Session.history")(function* (input) {
        yield* result.get(input.sessionID)
        return yield* EventV2.readAggregate(db, {
          ...input,
          aggregateID: input.sessionID,
          manifest: SessionDurable,
        })
      }),
      prompt: Effect.fn("V2Session.prompt")((input) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            yield* result.get(input.sessionID)
            const prompt = resolvePrompt(input.prompt)
            const messageID = input.id ?? SessionMessage.ID.create()
            const delivery = input.delivery ?? "steer"
            const expected = { sessionID: input.sessionID, messageID, prompt, delivery }
            const admitted = yield* SessionInput.admit(db, events, {
              id: messageID,
              sessionID: input.sessionID,
              prompt,
              delivery,
            }).pipe(
              Effect.catchDefect((defect) =>
                defect instanceof SessionInput.LifecycleConflict
                  ? new PromptConflictError({ sessionID: input.sessionID, messageID })
                  : Effect.die(defect),
              ),
            )
            if (!SessionInput.equivalent(admitted, expected))
              return yield* new PromptConflictError({ sessionID: input.sessionID, messageID })
            if (input.resume !== false) yield* execution.wake(admitted.sessionID)
            return admitted
          }),
        ),
      ),
      shell: Effect.fn("V2Session.shell")(function* () {
        return yield* new OperationUnavailableError({ operation: "shell" })
      }),
      skill: Effect.fn("V2Session.skill")(function* () {
        return yield* new OperationUnavailableError({ operation: "skill" })
      }),
      switchAgent: Effect.fn("V2Session.switchAgent")(function* (input) {
        yield* result.get(input.sessionID)
        yield* events.publish(SessionEvent.AgentSwitched, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: yield* DateTime.now,
          agent: input.agent,
        })
      }),
      switchModel: Effect.fn("V2Session.switchModel")(function* (input) {
        const session = yield* result.get(input.sessionID)
        if (
          session.model?.providerID === input.model.providerID &&
          session.model.id === input.model.id &&
          (session.model.variant ?? "default") === (input.model.variant ?? "default")
        )
          return
        yield* events.publish(SessionEvent.ModelSwitched, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: yield* DateTime.now,
          model: input.model,
        })
      }),
      compact: Effect.fn("V2Session.compact")(function* (input) {
        yield* result.get(input.sessionID)
        return yield* new OperationUnavailableError({ operation: "compact" })
      }),
      wait: Effect.fn("V2Session.wait")(function* (sessionID) {
        yield* result.get(sessionID)
        return yield* new OperationUnavailableError({ operation: "wait" })
      }),
      active: execution.active,
      resume: Effect.fn("V2Session.resume")(function* (sessionID) {
        yield* result.get(sessionID)
        yield* execution.resume(sessionID)
      }),
      interrupt: Effect.fn("V2Session.interrupt")((sessionID) =>
        Effect.uninterruptible(execution.interrupt(sessionID)),
      ),
      revert: {
        stage: Effect.fn("V2Session.revert.stage")(function* (input) {
          const session = yield* result.get(input.sessionID)
          return yield* SessionRevert.stage({ session, messageID: input.messageID, files: input.files }).pipe(
            Effect.provideService(Database.Service, database),
            Effect.provideService(EventV2.Service, events),
            Effect.provide(locations.get(session.location)),
          )
        }),
        clear: Effect.fn("V2Session.revert.clear")(function* (sessionID) {
          const session = yield* result.get(sessionID)
          yield* SessionRevert.clear(session).pipe(
            Effect.provideService(EventV2.Service, events),
            Effect.provide(locations.get(session.location)),
          )
        }),
        commit: Effect.fn("V2Session.revert.commit")(function* (sessionID) {
          const session = yield* result.get(sessionID)
          yield* SessionRevert.commit(session).pipe(Effect.provideService(EventV2.Service, events))
        }),
      },
    })

    return result
  }),
)

const resolvePrompt = (input: PromptInput.Prompt) =>
  Prompt.make({
    text: input.text,
    agents: input.agents,
    files: input.files?.map((file) => {
      const dataMime = file.uri.match(/^data:([^;,]+)[;,]/i)?.[1]
      const target = URL.canParse(file.uri) ? new URL(file.uri).pathname : (file.name ?? file.uri)
      return {
        ...file,
        mime: dataMime ?? (target.endsWith("/") ? "application/x-directory" : FSUtil.mimeType(target)),
      }
    }),
  })

export const node = makeGlobalNode({
  service: Service,
  layer: layer.pipe(Layer.orDie),
  deps: [
    Database.node,
    EventV2.node,
    ProjectV2.node,
    SessionExecution.node,
    SessionStore.node,
    LocationServiceMap.node,
    SessionProjector.node,
  ],
})
