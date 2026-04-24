import { Slug } from "@opencode-ai/shared/util/slug"
import path from "path"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Decimal } from "decimal.js"
import z from "zod"
import { type ProviderMetadata, type LanguageModelUsage } from "ai"
import { Flag } from "../flag/flag"
import { InstallationVersion } from "../installation/version"

import { Database, NotFoundError, eq, and, gte, isNull, desc, like, inArray, lt } from "../storage"
import { SyncEvent } from "../sync"
import type { SQL } from "../storage"
import { PartTable, SessionTable } from "./session.sql"
import { ProjectTable } from "../project/project.sql"
import { Storage } from "@/storage"
import { Log } from "../util"
import { MessageV2 } from "./message-v2"
import { Instance } from "../project/instance"
import { InstanceState } from "@/effect"
import { Snapshot } from "@/snapshot"
import { ProjectID } from "../project/schema"
import { WorkspaceID } from "../control-plane/schema"
import { SessionID, MessageID, PartID } from "./schema"

import type { Provider } from "@/provider"
import { Permission } from "@/permission"
import { Global } from "@/global"
import { Effect, Layer, Option, Context, Schema, Types } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

const log = Log.create({ service: "session" })

const parentTitlePrefix = "New session - "
const childTitlePrefix = "Child session - "

function createDefaultTitle(isChild = false) {
  return (isChild ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString()
}

export function isDefaultTitle(title: string) {
  return new RegExp(
    `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
  ).test(title)
}

type SessionRow = typeof SessionTable.$inferSelect

export function fromRow(row: SessionRow): Info {
  const summary =
    row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
      ? {
          additions: row.summary_additions ?? 0,
          deletions: row.summary_deletions ?? 0,
          files: row.summary_files ?? 0,
          diffs: row.summary_diffs ?? undefined,
        }
      : undefined
  const share = row.share_url ? { url: row.share_url } : undefined
  const revert = row.revert ?? undefined
  return {
    id: row.id,
    slug: row.slug,
    projectID: row.project_id,
    workspaceID: row.workspace_id ?? undefined,
    directory: row.directory,
    parentID: row.parent_id ?? undefined,
    title: row.title,
    version: row.version,
    summary,
    share,
    revert,
    permission: row.permission ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      compacting: row.time_compacting ?? undefined,
      archived: row.time_archived ?? undefined,
    },
  }
}

export function toRow(info: Info) {
  return {
    id: info.id,
    project_id: info.projectID,
    workspace_id: info.workspaceID,
    parent_id: info.parentID,
    slug: info.slug,
    directory: info.directory,
    title: info.title,
    version: info.version,
    share_url: info.share?.url,
    summary_additions: info.summary?.additions,
    summary_deletions: info.summary?.deletions,
    summary_files: info.summary?.files,
    summary_diffs: info.summary?.diffs,
    revert: info.revert ?? null,
    permission: info.permission,
    time_created: info.time.created,
    time_updated: info.time.updated,
    time_compacting: info.time.compacting,
    time_archived: info.time.archived,
  }
}

function getForkedTitle(title: string): string {
  const match = title.match(/^(.+) \(fork #(\d+)\)$/)
  if (match) {
    const base = match[1]
    const num = parseInt(match[2], 10)
    return `${base} (fork #${num + 1})`
  }
  return `${title} (fork #1)`
}

const Summary = Schema.Struct({
  additions: Schema.Number,
  deletions: Schema.Number,
  files: Schema.Number,
  diffs: Schema.optional(Schema.Array(Snapshot.FileDiff)),
})

const Share = Schema.Struct({
  url: Schema.String,
})

const Time = Schema.Struct({
  created: Schema.Number,
  updated: Schema.Number,
  compacting: Schema.optional(Schema.Number),
  archived: Schema.optional(Schema.Number),
})

const Revert = Schema.Struct({
  messageID: MessageID,
  partID: Schema.optional(PartID),
  snapshot: Schema.optional(Schema.String),
  diff: Schema.optional(Schema.String),
})

export const Info = Schema.Struct({
  id: SessionID,
  slug: Schema.String,
  projectID: ProjectID,
  workspaceID: Schema.optional(WorkspaceID),
  directory: Schema.String,
  parentID: Schema.optional(SessionID),
  summary: Schema.optional(Summary),
  share: Schema.optional(Share),
  title: Schema.String,
  version: Schema.String,
  time: Time,
  permission: Schema.optional(Permission.Ruleset),
  revert: Schema.optional(Revert),
})
  .annotate({ identifier: "Session" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const ProjectInfo = Schema.Struct({
  id: ProjectID,
  name: Schema.optional(Schema.String),
  worktree: Schema.String,
})
  .annotate({ identifier: "ProjectSummary" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ProjectInfo = Types.DeepMutable<Schema.Schema.Type<typeof ProjectInfo>>

export const GlobalInfo = Schema.Struct({
  ...Info.fields,
  project: Schema.NullOr(ProjectInfo),
})
  .annotate({ identifier: "GlobalSession" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type GlobalInfo = Types.DeepMutable<Schema.Schema.Type<typeof GlobalInfo>>

export const CreateInput = Schema.optional(
  Schema.Struct({
    parentID: Schema.optional(SessionID),
    title: Schema.optional(Schema.String),
    permission: Schema.optional(Permission.Ruleset),
    workspaceID: Schema.optional(WorkspaceID),
  }),
).pipe(withStatics((s) => ({ zod: zod(s) })))
export type CreateInput = Types.DeepMutable<Schema.Schema.Type<typeof CreateInput>>

export const ForkInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export const GetInput = SessionID
export const ChildrenInput = SessionID
export const RemoveInput = SessionID
export const SetTitleInput = Schema.Struct({ sessionID: SessionID, title: Schema.String }).pipe(
  withStatics((s) => ({ zod: zod(s) })),
)
export const SetArchivedInput = Schema.Struct({
  sessionID: SessionID,
  time: Schema.optional(Schema.Number),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export const SetPermissionInput = Schema.Struct({
  sessionID: SessionID,
  permission: Permission.Ruleset,
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export const SetRevertInput = Schema.Struct({
  sessionID: SessionID,
  revert: Schema.optional(Revert),
  summary: Schema.optional(Summary),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export const MessagesInput = Schema.Struct({
  sessionID: SessionID,
  limit: Schema.optional(Schema.Number),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

const CreatedEventSchema = Schema.Struct({
  sessionID: SessionID,
  info: Info,
})

const UpdatedShare = Schema.Struct({
  url: Schema.optional(Schema.NullOr(Schema.String)),
})

const UpdatedTime = Schema.Struct({
  created: Schema.optional(Schema.NullOr(Schema.Number)),
  updated: Schema.optional(Schema.NullOr(Schema.Number)),
  compacting: Schema.optional(Schema.NullOr(Schema.Number)),
  archived: Schema.optional(Schema.NullOr(Schema.Number)),
})

const UpdatedInfo = Schema.Struct({
  id: Schema.optional(Schema.NullOr(SessionID)),
  slug: Schema.optional(Schema.NullOr(Schema.String)),
  projectID: Schema.optional(Schema.NullOr(ProjectID)),
  workspaceID: Schema.optional(Schema.NullOr(WorkspaceID)),
  directory: Schema.optional(Schema.NullOr(Schema.String)),
  parentID: Schema.optional(Schema.NullOr(SessionID)),
  summary: Schema.optional(Schema.NullOr(Summary)),
  share: Schema.optional(UpdatedShare),
  title: Schema.optional(Schema.NullOr(Schema.String)),
  version: Schema.optional(Schema.NullOr(Schema.String)),
  time: Schema.optional(UpdatedTime),
  permission: Schema.optional(Schema.NullOr(Permission.Ruleset)),
  revert: Schema.optional(Schema.NullOr(Revert)),
})

const UpdatedEventSchema = Schema.Struct({
  sessionID: SessionID,
  info: UpdatedInfo,
})

export const Event = {
  Created: SyncEvent.define({
    type: "session.created",
    version: 1,
    aggregate: "sessionID",
    schema: CreatedEventSchema,
  }),
  Updated: SyncEvent.define({
    type: "session.updated",
    version: 1,
    aggregate: "sessionID",
    schema: UpdatedEventSchema,
    busSchema: CreatedEventSchema,
  }),
  Deleted: SyncEvent.define({
    type: "session.deleted",
    version: 1,
    aggregate: "sessionID",
    schema: CreatedEventSchema,
  }),
  Diff: BusEvent.define(
    "session.diff",
    Schema.Struct({
      sessionID: SessionID,
      diff: Schema.Array(Snapshot.FileDiff),
    }),
  ),
  Error: BusEvent.define(
    "session.error",
    Schema.Struct({
      sessionID: Schema.optional(SessionID),
      // Reuses MessageV2.Assistant.fields.error (already Schema.optional) so
      // the derived zod keeps the same discriminated-union shape on the bus.
      error: MessageV2.Assistant.fields.error,
    }),
  ),
}

export function plan(input: { slug: string; time: { created: number } }) {
  const base = Instance.project.vcs
    ? path.join(Instance.worktree, ".opencode", "plans")
    : path.join(Global.Path.data, "plans")
  return path.join(base, [input.time.created, input.slug].join("-") + ".md")
}

export const getUsage = (input: { model: Provider.Model; usage: LanguageModelUsage; metadata?: ProviderMetadata }) => {
  const safe = (value: number) => {
    if (!Number.isFinite(value)) return 0
    return value
  }
  const inputTokens = safe(input.usage.inputTokens ?? 0)
  const outputTokens = safe(input.usage.outputTokens ?? 0)
  const reasoningTokens = safe(input.usage.outputTokenDetails?.reasoningTokens ?? input.usage.reasoningTokens ?? 0)

  const cacheReadInputTokens = safe(
    input.usage.inputTokenDetails?.cacheReadTokens ?? input.usage.cachedInputTokens ?? 0,
  )
  const cacheWriteInputTokens = safe(
    Number(
      input.usage.inputTokenDetails?.cacheWriteTokens ??
        input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
        // google-vertex-anthropic returns metadata under "vertex" key
        // (AnthropicMessagesLanguageModel custom provider key from 'vertex.anthropic.messages')
        input.metadata?.["vertex"]?.["cacheCreationInputTokens"] ??
        // @ts-expect-error
        input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
        // @ts-expect-error
        input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ??
        0,
    ),
  )

  // AI SDK v6 normalized inputTokens to include cached tokens across all providers
  // (including Anthropic/Bedrock which previously excluded them). Always subtract cache
  // tokens to get the non-cached input count for separate cost calculation.
  const adjustedInputTokens = safe(inputTokens - cacheReadInputTokens - cacheWriteInputTokens)

  const total = input.usage.totalTokens

  const tokens = {
    total,
    input: adjustedInputTokens,
    output: safe(outputTokens - reasoningTokens),
    reasoning: reasoningTokens,
    cache: {
      write: cacheWriteInputTokens,
      read: cacheReadInputTokens,
    },
  }

  const costInfo =
    input.model.cost?.experimentalOver200K && tokens.input + tokens.cache.read > 200_000
      ? input.model.cost.experimentalOver200K
      : input.model.cost
  return {
    cost: safe(
      new Decimal(0)
        .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
        .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
        .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
        .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
        // TODO: update models.dev to have better pricing model, for now:
        // charge reasoning tokens at the same rate as output tokens
        .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
        .toNumber(),
    ),
    tokens,
  }
}

export class BusyError extends Error {
  constructor(public readonly sessionID: string) {
    super(`Session ${sessionID} is busy`)
  }
}

export interface Interface {
  readonly create: (input?: {
    parentID?: SessionID
    title?: string
    permission?: Permission.Ruleset
    workspaceID?: WorkspaceID
  }) => Effect.Effect<Info>
  readonly fork: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Info>
  readonly touch: (sessionID: SessionID) => Effect.Effect<void>
  readonly get: (id: SessionID) => Effect.Effect<Info>
  readonly setTitle: (input: { sessionID: SessionID; title: string }) => Effect.Effect<void>
  readonly setArchived: (input: { sessionID: SessionID; time?: number }) => Effect.Effect<void>
  readonly setPermission: (input: { sessionID: SessionID; permission: Permission.Ruleset }) => Effect.Effect<void>
  readonly setRevert: (input: {
    sessionID: SessionID
    revert: Info["revert"]
    summary: Info["summary"]
  }) => Effect.Effect<void>
  readonly clearRevert: (sessionID: SessionID) => Effect.Effect<void>
  readonly setSummary: (input: { sessionID: SessionID; summary: Info["summary"] }) => Effect.Effect<void>
  readonly diff: (sessionID: SessionID) => Effect.Effect<Snapshot.FileDiff[]>
  readonly messages: (input: { sessionID: SessionID; limit?: number }) => Effect.Effect<MessageV2.WithParts[]>
  readonly children: (parentID: SessionID) => Effect.Effect<Info[]>
  readonly remove: (sessionID: SessionID) => Effect.Effect<void>
  readonly updateMessage: <T extends MessageV2.Info>(msg: T) => Effect.Effect<T>
  readonly removeMessage: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<MessageID>
  readonly removePart: (input: { sessionID: SessionID; messageID: MessageID; partID: PartID }) => Effect.Effect<PartID>
  readonly getPart: (input: {
    sessionID: SessionID
    messageID: MessageID
    partID: PartID
  }) => Effect.Effect<MessageV2.Part | undefined>
  readonly updatePart: <T extends MessageV2.Part>(part: T) => Effect.Effect<T>
  readonly updatePartDelta: (input: {
    sessionID: SessionID
    messageID: MessageID
    partID: PartID
    field: string
    delta: string
  }) => Effect.Effect<void>
  /** Finds the first message matching the predicate, searching newest-first. */
  readonly findMessage: (
    sessionID: SessionID,
    predicate: (msg: MessageV2.WithParts) => boolean,
  ) => Effect.Effect<Option.Option<MessageV2.WithParts>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Session") {}

export type Patch = Types.DeepMutable<SyncEvent.Event<typeof Event.Updated>["data"]["info"]>

const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
  Effect.sync(() => Database.use(fn))

export const layer: Layer.Layer<Service, never, Bus.Service | Storage.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const storage = yield* Storage.Service

    const createNext = Effect.fn("Session.createNext")(function* (input: {
      id?: SessionID
      title?: string
      parentID?: SessionID
      workspaceID?: WorkspaceID
      directory: string
      permission?: Permission.Ruleset
    }) {
      const ctx = yield* InstanceState.context
      const result: Info = {
        id: SessionID.descending(input.id),
        slug: Slug.create(),
        version: InstallationVersion,
        projectID: ctx.project.id,
        directory: input.directory,
        workspaceID: input.workspaceID,
        parentID: input.parentID,
        title: input.title ?? createDefaultTitle(!!input.parentID),
        permission: input.permission,
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      }
      log.info("created", result)

      yield* Effect.sync(() => SyncEvent.run(Event.Created, { sessionID: result.id, info: result }))

      if (!Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
        // This only exist for backwards compatibility. We should not be
        // manually publishing this event; it is a sync event now
        yield* bus.publish(Event.Updated, {
          sessionID: result.id,
          info: result,
        })
      }

      return result
    })

    const get = Effect.fn("Session.get")(function* (id: SessionID) {
      const row = yield* db((d) => d.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
      if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
      return fromRow(row)
    })

    const children = Effect.fn("Session.children")(function* (parentID: SessionID) {
      const rows = yield* db((d) =>
        d
          .select()
          .from(SessionTable)
          .where(and(eq(SessionTable.parent_id, parentID)))
          .all(),
      )
      return rows.map(fromRow)
    })

    const remove: Interface["remove"] = Effect.fnUntraced(function* (sessionID: SessionID) {
      try {
        const session = yield* get(sessionID)
        const kids = yield* children(sessionID)
        for (const child of kids) {
          yield* remove(child.id)
        }

        // `remove` needs to work in all cases, such as a broken
        // sessions that run cleanup. In certain cases these will
        // run without any instance state, so we need to turn off
        // publishing of events in that case
        const hasInstance = yield* InstanceState.directory.pipe(
          Effect.as(true),
          Effect.catchCause(() => Effect.succeed(false)),
        )

        yield* Effect.sync(() => {
          SyncEvent.run(Event.Deleted, { sessionID, info: session }, { publish: hasInstance })
          SyncEvent.remove(sessionID)
        })
      } catch (e) {
        log.error(e)
      }
    })

    const updateMessage = <T extends MessageV2.Info>(msg: T): Effect.Effect<T> =>
      Effect.gen(function* () {
        yield* Effect.sync(() => SyncEvent.run(MessageV2.Event.Updated, { sessionID: msg.sessionID, info: msg }))
        return msg
      }).pipe(Effect.withSpan("Session.updateMessage"))

    const updatePart = <T extends MessageV2.Part>(part: T): Effect.Effect<T> =>
      Effect.gen(function* () {
        yield* Effect.sync(() =>
          SyncEvent.run(MessageV2.Event.PartUpdated, {
            sessionID: part.sessionID,
            part: structuredClone(part),
            time: Date.now(),
          }),
        )
        return part
      }).pipe(Effect.withSpan("Session.updatePart"))

    const getPart: Interface["getPart"] = Effect.fn("Session.getPart")(function* (input) {
      const row = Database.use((db) =>
        db
          .select()
          .from(PartTable)
          .where(
            and(
              eq(PartTable.session_id, input.sessionID),
              eq(PartTable.message_id, input.messageID),
              eq(PartTable.id, input.partID),
            ),
          )
          .get(),
      )
      if (!row) return
      return {
        ...row.data,
        id: row.id,
        sessionID: row.session_id,
        messageID: row.message_id,
      } as MessageV2.Part
    })

    const create = Effect.fn("Session.create")(function* (input?: {
      parentID?: SessionID
      title?: string
      permission?: Permission.Ruleset
      workspaceID?: WorkspaceID
    }) {
      const directory = yield* InstanceState.directory
      const workspace = yield* InstanceState.workspaceID
      return yield* createNext({
        parentID: input?.parentID,
        directory,
        title: input?.title,
        permission: input?.permission,
        workspaceID: workspace,
      })
    })

    const fork = Effect.fn("Session.fork")(function* (input: { sessionID: SessionID; messageID?: MessageID }) {
      const directory = yield* InstanceState.directory
      const original = yield* get(input.sessionID)
      const title = getForkedTitle(original.title)
      const session = yield* createNext({
        directory,
        workspaceID: original.workspaceID,
        title,
      })
      const msgs = yield* messages({ sessionID: input.sessionID })
      const idMap = new Map<string, MessageID>()

      for (const msg of msgs) {
        if (input.messageID && msg.info.id >= input.messageID) break
        const newID = MessageID.ascending()
        idMap.set(msg.info.id, newID)

        const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
        const cloned = yield* updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID }),
        })

        for (const part of msg.parts) {
          yield* updatePart({
            ...part,
            id: PartID.ascending(),
            messageID: cloned.id,
            sessionID: session.id,
          })
        }
      }
      return session
    })

    const patch = (sessionID: SessionID, info: Patch) =>
      Effect.sync(() => SyncEvent.run(Event.Updated, { sessionID, info }))

    const touch = Effect.fn("Session.touch")(function* (sessionID: SessionID) {
      yield* patch(sessionID, { time: { updated: Date.now() } })
    })

    const setTitle = Effect.fn("Session.setTitle")(function* (input: { sessionID: SessionID; title: string }) {
      yield* patch(input.sessionID, { title: input.title })
    })

    const setArchived = Effect.fn("Session.setArchived")(function* (input: { sessionID: SessionID; time?: number }) {
      yield* patch(input.sessionID, { time: { archived: input.time } })
    })

    const setPermission = Effect.fn("Session.setPermission")(function* (input: {
      sessionID: SessionID
      permission: Permission.Ruleset
    }) {
      yield* patch(input.sessionID, { permission: input.permission, time: { updated: Date.now() } })
    })

    const setRevert = Effect.fn("Session.setRevert")(function* (input: {
      sessionID: SessionID
      revert: Info["revert"]
      summary: Info["summary"]
    }) {
      yield* patch(input.sessionID, { summary: input.summary, time: { updated: Date.now() }, revert: input.revert })
    })

    const clearRevert = Effect.fn("Session.clearRevert")(function* (sessionID: SessionID) {
      yield* patch(sessionID, { time: { updated: Date.now() }, revert: null })
    })

    const setSummary = Effect.fn("Session.setSummary")(function* (input: {
      sessionID: SessionID
      summary: Info["summary"]
    }) {
      yield* patch(input.sessionID, { time: { updated: Date.now() }, summary: input.summary })
    })

    const diff = Effect.fn("Session.diff")(function* (sessionID: SessionID) {
      return yield* storage
        .read<Snapshot.FileDiff[]>(["session_diff", sessionID])
        .pipe(Effect.orElseSucceed((): Snapshot.FileDiff[] => []))
    })

    const messages = Effect.fn("Session.messages")(function* (input: { sessionID: SessionID; limit?: number }) {
      if (input.limit) {
        return MessageV2.page({ sessionID: input.sessionID, limit: input.limit }).items
      }
      return Array.from(MessageV2.stream(input.sessionID)).reverse()
    })

    const removeMessage = Effect.fn("Session.removeMessage")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      yield* Effect.sync(() =>
        SyncEvent.run(MessageV2.Event.Removed, {
          sessionID: input.sessionID,
          messageID: input.messageID,
        }),
      )
      return input.messageID
    })

    const removePart = Effect.fn("Session.removePart")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      partID: PartID
    }) {
      yield* Effect.sync(() =>
        SyncEvent.run(MessageV2.Event.PartRemoved, {
          sessionID: input.sessionID,
          messageID: input.messageID,
          partID: input.partID,
        }),
      )
      return input.partID
    })

    const updatePartDelta = Effect.fnUntraced(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      partID: PartID
      field: string
      delta: string
    }) {
      yield* bus.publish(MessageV2.Event.PartDelta, input)
    })

    /** Finds the first message matching the predicate, searching newest-first. */
    const findMessage = Effect.fn("Session.findMessage")(function* (
      sessionID: SessionID,
      predicate: (msg: MessageV2.WithParts) => boolean,
    ) {
      for (const item of MessageV2.stream(sessionID)) {
        if (predicate(item)) return Option.some(item)
      }
      return Option.none<MessageV2.WithParts>()
    })

    return Service.of({
      create,
      fork,
      touch,
      get,
      setTitle,
      setArchived,
      setPermission,
      setRevert,
      clearRevert,
      setSummary,
      diff,
      messages,
      children,
      remove,
      updateMessage,
      removeMessage,
      removePart,
      updatePart,
      getPart,
      updatePartDelta,
      findMessage,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer), Layer.provide(Storage.defaultLayer))

export function* list(input?: {
  directory?: string
  workspaceID?: WorkspaceID
  roots?: boolean
  start?: number
  search?: string
  limit?: number
}) {
  const project = Instance.project
  const conditions = [eq(SessionTable.project_id, project.id)]

  if (input?.workspaceID) {
    conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
  }
  if (!Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
    if (input?.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
    }
  }
  if (input?.roots) {
    conditions.push(isNull(SessionTable.parent_id))
  }
  if (input?.start) {
    conditions.push(gte(SessionTable.time_updated, input.start))
  }
  if (input?.search) {
    conditions.push(like(SessionTable.title, `%${input.search}%`))
  }

  const limit = input?.limit ?? 100

  const rows = Database.use((db) =>
    db
      .select()
      .from(SessionTable)
      .where(and(...conditions))
      .orderBy(desc(SessionTable.time_updated))
      .limit(limit)
      .all(),
  )
  for (const row of rows) {
    yield fromRow(row)
  }
}

export function* listGlobal(input?: {
  directory?: string
  roots?: boolean
  start?: number
  cursor?: number
  search?: string
  limit?: number
  archived?: boolean
}) {
  const conditions: SQL[] = []

  if (input?.directory) {
    conditions.push(eq(SessionTable.directory, input.directory))
  }
  if (input?.roots) {
    conditions.push(isNull(SessionTable.parent_id))
  }
  if (input?.start) {
    conditions.push(gte(SessionTable.time_updated, input.start))
  }
  if (input?.cursor) {
    conditions.push(lt(SessionTable.time_updated, input.cursor))
  }
  if (input?.search) {
    conditions.push(like(SessionTable.title, `%${input.search}%`))
  }
  if (!input?.archived) {
    conditions.push(isNull(SessionTable.time_archived))
  }

  const limit = input?.limit ?? 100

  const rows = Database.use((db) => {
    const query =
      conditions.length > 0
        ? db
            .select()
            .from(SessionTable)
            .where(and(...conditions))
        : db.select().from(SessionTable)
    return query.orderBy(desc(SessionTable.time_updated), desc(SessionTable.id)).limit(limit).all()
  })

  const ids = [...new Set(rows.map((row) => row.project_id))]
  const projects = new Map<string, ProjectInfo>()

  if (ids.length > 0) {
    const items = Database.use((db) =>
      db
        .select({ id: ProjectTable.id, name: ProjectTable.name, worktree: ProjectTable.worktree })
        .from(ProjectTable)
        .where(inArray(ProjectTable.id, ids))
        .all(),
    )
    for (const item of items) {
      projects.set(item.id, {
        id: item.id,
        name: item.name ?? undefined,
        worktree: item.worktree,
      })
    }
  }

  for (const row of rows) {
    const project = projects.get(row.project_id) ?? null
    yield { ...fromRow(row), project }
  }
}
