export * as SessionV2 from "./session"
export * from "./session/schema"

import { Effect, Layer, Schema, Context } from "effect"
import { and, asc, desc, eq, gt, gte, like, lt, or, type SQL } from "drizzle-orm"
import { ProjectV2 } from "./project"
import { WorkspaceV2 } from "./workspace"
import { ModelV2 } from "./model"
import { Location } from "./location"
import { SessionMessage } from "./session/message"
import { Prompt } from "./session/prompt"
import { EventV2 } from "./event"
import { ProviderV2 } from "./provider"
import { Database } from "./database/database"
import { SessionProjector } from "./session/projector"
import { SessionCreateAdmissionTable, SessionMessageTable, SessionTable } from "./session/sql"
import { SessionSchema } from "./session/schema"
import { AbsolutePath, PositiveInt, RelativePath } from "./schema"
import { AgentV2 } from "./agent"
import { SessionLegacy } from "./session/legacy"
import { InstallationVersion } from "./installation/version"
import { Slug } from "./util/slug"
import { ProjectTable } from "./project/sql"
import path from "path"
import { fromRow } from "./session/info"
import { PromptConflictError, SessionRuntime } from "./session/runtime"

export { PromptConflictError } from "./session/runtime"

// get project -> project.locations
//
// get all sessions
//

// - by project
//   - by subpath
// - by workspace (home is special)

export const ListAnchor = Schema.Struct({
  id: SessionSchema.ID,
  time: Schema.Finite,
  direction: Schema.Literals(["previous", "next"]),
})
export type ListAnchor = typeof ListAnchor.Type

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
  idempotencyKey?: SessionSchema.CreateIdempotencyKey
  agent?: AgentV2.ID
  model?: ModelV2.Ref
  location: Location.Ref
}

type MoveInput = {
  sessionID: SessionSchema.ID
  location: Location.Ref
}

type CompactInput = {
  sessionID: SessionSchema.ID
  prompt?: Prompt
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Session.NotFoundError", {
  sessionID: SessionSchema.ID,
}) {}

export class OperationUnavailableError extends Schema.TaggedErrorClass<OperationUnavailableError>()(
  "Session.OperationUnavailableError",
  {
    operation: Schema.Literals(["prompt", "compact", "wait"]),
  },
) {}

export class MessageDecodeError extends Schema.TaggedErrorClass<MessageDecodeError>()("Session.MessageDecodeError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {}

export class CreateConflictError extends Schema.TaggedErrorClass<CreateConflictError>()("Session.CreateConflictError", {
  idempotencyKey: SessionSchema.CreateIdempotencyKey,
}) {}

export type Error = NotFoundError | MessageDecodeError | OperationUnavailableError | PromptConflictError | CreateConflictError

export interface Interface {
  readonly list: (input?: ListInput) => Effect.Effect<SessionSchema.Info[]>
  readonly create: (input: CreateInput) => Effect.Effect<SessionSchema.Info, CreateConflictError>
  readonly move: (input: MoveInput) => Effect.Effect<void, NotFoundError>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info, NotFoundError>
  readonly messages: (input: {
    sessionID: SessionSchema.ID
    limit?: number
    order?: "asc" | "desc"
    cursor?: {
      id: SessionMessage.ID
      time: number
      direction: "previous" | "next"
    }
  }) => Effect.Effect<SessionMessage.Message[], NotFoundError | MessageDecodeError>
  readonly context: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<SessionMessage.Message[], NotFoundError | MessageDecodeError>
  readonly switchAgent: (input: { sessionID: SessionSchema.ID; agent: string }) => Effect.Effect<void, never>
  readonly switchModel: (input: { sessionID: SessionSchema.ID; model: ModelV2.Ref }) => Effect.Effect<void, never>
  readonly prompt: (input: {
    id?: EventV2.ID
    sessionID: SessionSchema.ID
    idempotencyKey?: Prompt.IdempotencyKey
    prompt: Prompt
    delivery?: SessionSchema.Delivery
    resume?: boolean
  }) => Effect.Effect<SessionMessage.User, NotFoundError | PromptConflictError>
  readonly shell: (input: {
    id?: EventV2.ID
    sessionID: SessionSchema.ID
    command: string
    delivery?: SessionSchema.Delivery
    resume?: boolean
  }) => Effect.Effect<void, never>
  readonly skill: (input: {
    id?: EventV2.ID
    sessionID: SessionSchema.ID
    skill: string
    delivery?: SessionSchema.Delivery
    resume?: boolean
  }) => Effect.Effect<void, never>
  readonly compact: (input: CompactInput) => Effect.Effect<void, NotFoundError | OperationUnavailableError>
  readonly wait: (id: SessionSchema.ID) => Effect.Effect<void, NotFoundError | OperationUnavailableError>
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Session") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const events = yield* EventV2.Service
    const projects = yield* ProjectV2.Service
    const runtime = yield* SessionRuntime.Service
    const decodeMessage = Schema.decodeUnknownEffect(SessionMessage.Message)
    const decodeSession = Schema.decodeUnknownEffect(SessionSchema.Info)

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

    const findCreateAdmission = Effect.fnUntraced(function* (input: {
      idempotencyKey: SessionSchema.CreateIdempotencyKey
      contract: SessionSchema.CreateContract
    }) {
      const admitted = yield* db
        .select()
        .from(SessionCreateAdmissionTable)
        .where(eq(SessionCreateAdmissionTable.idempotency_key, input.idempotencyKey))
        .get()
        .pipe(Effect.orDie)
      if (!admitted) return undefined
      const contract = yield* SessionSchema.decodeCreateContract(admitted.contract).pipe(Effect.orDie)
      if (!SessionSchema.createContractEquivalence(contract, input.contract)) {
        return yield* new CreateConflictError({ idempotencyKey: input.idempotencyKey })
      }
      return yield* decodeSession(admitted.session).pipe(Effect.orDie)
    })

    const result = Service.of({
      create: Effect.fn("V2Session.create")(function* (input) {
        const contract = SessionSchema.CreateContract.make({
          location: Location.Ref.make({
            directory: input.location.directory,
            ...(input.location.workspaceID === undefined ? {} : { workspaceID: input.location.workspaceID }),
          }),
          ...(input.agent === undefined ? {} : { agent: input.agent }),
          ...(input.model === undefined
            ? {}
            : {
                model: ModelV2.Ref.make({
                  id: input.model.id,
                  providerID: input.model.providerID,
                  ...(input.model.variant === undefined ? {} : { variant: input.model.variant }),
                }),
              }),
        })
        const admission = input.idempotencyKey === undefined ? undefined : { idempotencyKey: input.idempotencyKey, contract }
        if (admission !== undefined) {
          const admitted = yield* findCreateAdmission(admission)
          if (admitted) return admitted
        }
        const project = yield* projects.resolve(input.location.directory)
        yield* db
          .insert(ProjectTable)
          .values({ id: project.id, worktree: project.directory, vcs: project.vcs?.type, sandboxes: [] })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        const now = Date.now()
        const sessionID = SessionSchema.ID.descending()
        const info = SessionLegacy.SessionInfo.make({
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
                id: ProviderV2.ModelID.make(input.model.id),
                providerID: input.model.providerID,
                variant: input.model.variant,
              }
            : undefined,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: now, updated: now },
        })
        const raced = yield* events
          .publish(
            SessionLegacy.Event.Created,
            { sessionID, info, createAdmission: admission },
            { location: input.location },
          )
          .pipe(
            Effect.as<SessionSchema.Info | undefined>(undefined),
            Effect.catchDefect((defect) => {
              if (!(defect instanceof SessionProjector.CreateAdmissionRace) || admission === undefined) {
                return Effect.die(defect)
              }
              return findCreateAdmission(admission).pipe(
                Effect.flatMap((admitted) => (admitted ? Effect.succeed(admitted) : Effect.die(defect))),
              )
            }),
          )
        if (raced) return raced
        // TODO: Restore admitted sessions onto replacement synchronized workspaces in a future API slice.
        return yield* result.get(sessionID).pipe(Effect.orDie)
      }),
      get: Effect.fn("V2Session.get")(function* (sessionID) {
        const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
        if (!row) return yield* new NotFoundError({ sessionID })
        return fromRow(row)
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
        const direction = input.cursor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
        const boundary = input.cursor
          ? order === "asc"
            ? or(
                gt(SessionMessageTable.time_created, input.cursor.time),
                and(
                  eq(SessionMessageTable.time_created, input.cursor.time),
                  gt(SessionMessageTable.id, input.cursor.id),
                ),
              )
            : or(
                lt(SessionMessageTable.time_created, input.cursor.time),
                and(
                  eq(SessionMessageTable.time_created, input.cursor.time),
                  lt(SessionMessageTable.id, input.cursor.id),
                ),
              )
          : undefined
        const where = boundary
          ? and(eq(SessionMessageTable.session_id, input.sessionID), boundary)
          : eq(SessionMessageTable.session_id, input.sessionID)
        const query = db
          .select()
          .from(SessionMessageTable)
          .where(where)
          .orderBy(
            order === "asc" ? asc(SessionMessageTable.time_created) : desc(SessionMessageTable.time_created),
            order === "asc" ? asc(SessionMessageTable.id) : desc(SessionMessageTable.id),
          )
        const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(
          Effect.orDie,
        )
        return yield* Effect.forEach(direction === "previous" ? rows.toReversed() : rows, decode)
      }),
      context: Effect.fn("V2Session.context")(function* (sessionID) {
        yield* result.get(sessionID)
        const compaction = yield* db
          .select()
          .from(SessionMessageTable)
          .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "compaction")))
          .orderBy(desc(SessionMessageTable.time_created), desc(SessionMessageTable.id))
          .limit(1)
          .get()
          .pipe(Effect.orDie)
        const rows = yield* db
          .select()
          .from(SessionMessageTable)
          .where(
            and(
              eq(SessionMessageTable.session_id, sessionID),
              compaction
                ? or(
                    gt(SessionMessageTable.time_created, compaction.time_created),
                    and(
                      eq(SessionMessageTable.time_created, compaction.time_created),
                      gte(SessionMessageTable.id, compaction.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(SessionMessageTable.time_created), asc(SessionMessageTable.id))
          .all()
          .pipe(Effect.orDie)
        return yield* Effect.forEach(rows, decode)
      }),
      prompt: Effect.fn("V2Session.prompt")(function* (input) {
        yield* result.get(input.sessionID)
        return yield* runtime.prompt(input)
      }),
      shell: Effect.fn("V2Session.shell")(function* () {}),
      skill: Effect.fn("V2Session.skill")(function* () {}),
      switchAgent: Effect.fn("V2Session.switchAgent")(function* () {}),
      switchModel: Effect.fn("V2Session.switchModel")(function* () {}),
      compact: Effect.fn("V2Session.compact")(function* (input) {
        yield* result.get(input.sessionID)
        return yield* new OperationUnavailableError({ operation: "compact" })
      }),
      wait: Effect.fn("V2Session.wait")(function* (sessionID) {
        yield* result.get(sessionID)
        return yield* new OperationUnavailableError({ operation: "wait" })
      }),
      resume: Effect.fn("V2Session.resume")(function* (sessionID) {
        yield* result.get(sessionID)
        yield* runtime.resume(sessionID)
      }),
      move: Effect.fn("V2Session.move")(function* () {}),
    })

    return result
  }),
)

const DefaultDatabase = Database.defaultLayer
const DefaultEvents = EventV2.layer.pipe(Layer.provide(DefaultDatabase))
const DefaultProjector = SessionProjector.layer.pipe(Layer.provide(DefaultEvents), Layer.provide(DefaultDatabase))
const DefaultRuntime = SessionRuntime.localLayer.pipe(Layer.provide(DefaultEvents), Layer.provide(DefaultDatabase))

export const defaultLayer = layer.pipe(
  Layer.provide(Layer.mergeAll(DefaultDatabase, DefaultEvents, DefaultProjector, DefaultRuntime, ProjectV2.defaultLayer)),
  Layer.orDie,
)
