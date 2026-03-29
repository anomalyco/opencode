import { Slug } from "@opencode-ai/util/slug"
import path from "path"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Decimal } from "decimal.js"
import z from "zod"
import { type ProviderMetadata } from "ai"
import { Config } from "../config/config"
import { Flag } from "../flag/flag"
import { Installation } from "../installation"

import { Database, NotFoundError, eq, and, gte, isNull, desc, like, inArray, lt } from "../storage/db"
import { SyncEvent } from "../sync"
import type { SQL } from "../storage/db"
import { SessionTable } from "./session.sql"
import { ProjectTable } from "../project/project.sql"
import { Storage } from "@/storage/storage"
import { Log } from "../util/log"
import { updateSchema } from "../util/update-schema"
import { MessageV2 } from "./message-v2"
import { Instance } from "../project/instance"
import { SessionPrompt } from "./prompt"
import { fn } from "@/util/fn"
import { Command } from "../command"
import { Snapshot } from "@/snapshot"
import { ProjectID } from "../project/schema"
import { WorkspaceID } from "../control-plane/schema"
import { SessionID, MessageID, PartID } from "./schema"

import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Permission } from "@/permission"
import { Global } from "@/global"
import type { LanguageModelV2Usage } from "@ai-sdk/provider"
import { Effect, Layer, Scope, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"

export namespace Session {
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

  export const Info = z
    .object({
      id: SessionID.zod,
      slug: z.string(),
      projectID: ProjectID.zod,
      workspaceID: WorkspaceID.zod.optional(),
      directory: z.string(),
      parentID: SessionID.zod.optional(),
      summary: z
        .object({
          additions: z.number(),
          deletions: z.number(),
          files: z.number(),
          diffs: Snapshot.FileDiff.array().optional(),
        })
        .optional(),
      share: z
        .object({
          url: z.string(),
        })
        .optional(),
      title: z.string(),
      version: z.string(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        compacting: z.number().optional(),
        archived: z.number().optional(),
      }),
      permission: Permission.Ruleset.optional(),
      revert: z
        .object({
          messageID: MessageID.zod,
          partID: PartID.zod.optional(),
          snapshot: z.string().optional(),
          diff: z.string().optional(),
        })
        .optional(),
    })
    .meta({
      ref: "Session",
    })
  export type Info = z.output<typeof Info>

  export const ProjectInfo = z
    .object({
      id: ProjectID.zod,
      name: z.string().optional(),
      worktree: z.string(),
    })
    .meta({
      ref: "ProjectSummary",
    })
  export type ProjectInfo = z.output<typeof ProjectInfo>

  export const GlobalInfo = Info.extend({
    project: ProjectInfo.nullable(),
  }).meta({
    ref: "GlobalSession",
  })
  export type GlobalInfo = z.output<typeof GlobalInfo>

  export const Event = {
    Created: SyncEvent.define({
      type: "session.created",
      version: 1,
      aggregate: "sessionID",
      schema: z.object({
        sessionID: SessionID.zod,
        info: Info,
      }),
    }),
    Updated: SyncEvent.define({
      type: "session.updated",
      version: 1,
      aggregate: "sessionID",
      schema: z.object({
        sessionID: SessionID.zod,
        info: updateSchema(Info).extend({
          share: updateSchema(Info.shape.share.unwrap()).optional(),
          time: updateSchema(Info.shape.time).optional(),
        }),
      }),
      busSchema: z.object({
        sessionID: SessionID.zod,
        info: Info,
      }),
    }),
    Deleted: SyncEvent.define({
      type: "session.deleted",
      version: 1,
      aggregate: "sessionID",
      schema: z.object({
        sessionID: SessionID.zod,
        info: Info,
      }),
    }),
    Diff: BusEvent.define(
      "session.diff",
      z.object({
        sessionID: SessionID.zod,
        diff: Snapshot.FileDiff.array(),
      }),
    ),
    Error: BusEvent.define(
      "session.error",
      z.object({
        sessionID: SessionID.zod.optional(),
        error: MessageV2.Assistant.shape.error,
      }),
    ),
  }

  export function plan(input: { slug: string; time: { created: number } }) {
    const base = Instance.project.vcs
      ? path.join(Instance.worktree, ".opencode", "plans")
      : path.join(Global.Path.data, "plans")
    return path.join(base, [input.time.created, input.slug].join("-") + ".md")
  }

  export const getUsage = (input: {
    model: Provider.Model
    usage: LanguageModelV2Usage
    metadata?: ProviderMetadata
  }) => {
    const safe = (value: number) => {
      if (!Number.isFinite(value)) return 0
      return value
    }
    const inputTokens = safe(input.usage.inputTokens ?? 0)
    const outputTokens = safe(input.usage.outputTokens ?? 0)
    const reasoningTokens = safe(input.usage.reasoningTokens ?? 0)

    const cacheReadInputTokens = safe(input.usage.cachedInputTokens ?? 0)
    const cacheWriteInputTokens = safe(
      (input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
        // @ts-expect-error
        input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
        // @ts-expect-error
        input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ??
        0) as number,
    )

    // AI SDK v6 normalized inputTokens to include cached tokens across all providers
    // (including Anthropic/Bedrock which previously excluded them). Always subtract cache
    // tokens to get the non-cached input count for separate cost calculation.
    const adjustedInputTokens = safe(inputTokens - cacheReadInputTokens - cacheWriteInputTokens)

    const total = input.usage.totalTokens

    const tokens = {
      total,
      input: adjustedInputTokens,
      output: outputTokens,
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
    readonly share: (id: SessionID) => Effect.Effect<{ url: string }>
    readonly unshare: (id: SessionID) => Effect.Effect<void>
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
    readonly updateMessage: (msg: MessageV2.Info) => Effect.Effect<MessageV2.Info>
    readonly removeMessage: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<MessageID>
    readonly removePart: (input: {
      sessionID: SessionID
      messageID: MessageID
      partID: PartID
    }) => Effect.Effect<PartID>
    readonly updatePart: (part: MessageV2.Part) => Effect.Effect<MessageV2.Part>
    readonly updatePartDelta: (input: {
      sessionID: SessionID
      messageID: MessageID
      partID: PartID
      field: string
      delta: string
    }) => Effect.Effect<void>
    readonly initialize: (input: {
      sessionID: SessionID
      modelID: ModelID
      providerID: ProviderID
      messageID: MessageID
    }) => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Session") {}

  type Patch = z.infer<typeof Event.Updated.schema>["info"]

  const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
    Effect.sync(() => Database.use(fn))

  export const layer: Layer.Layer<Service, never, Bus.Service | Config.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const config = yield* Config.Service
      const scope = yield* Scope.Scope

      const createNext = Effect.fn("Session.createNext")(function* (input: {
        id?: SessionID
        title?: string
        parentID?: SessionID
        workspaceID?: WorkspaceID
        directory: string
        permission?: Permission.Ruleset
      }) {
        const result: Info = {
          id: SessionID.descending(input.id),
          slug: Slug.create(),
          version: Installation.VERSION,
          projectID: Instance.project.id,
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

        const cfg = yield* config.get()
        if (!result.parentID && (Flag.OPENCODE_AUTO_SHARE || cfg.share === "auto")) {
          yield* share(result.id).pipe(Effect.ignore, Effect.forkIn(scope))
        }

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

      const share = Effect.fn("Session.share")(function* (id: SessionID) {
        const cfg = yield* config.get()
        if (cfg.share === "disabled") throw new Error("Sharing is disabled in configuration")
        const result = yield* Effect.promise(async () => {
          const { ShareNext } = await import("@/share/share-next")
          return ShareNext.create(id)
        })
        yield* Effect.sync(() => SyncEvent.run(Event.Updated, { sessionID: id, info: { share: { url: result.url } } }))
        return result
      })

      const unshare = Effect.fn("Session.unshare")(function* (id: SessionID) {
        yield* Effect.promise(async () => {
          const { ShareNext } = await import("@/share/share-next")
          await ShareNext.remove(id)
        })
        yield* Effect.sync(() => SyncEvent.run(Event.Updated, { sessionID: id, info: { share: { url: null } } }))
      })

      const children = Effect.fn("Session.children")(function* (parentID: SessionID) {
        const project = Instance.project
        const rows = yield* db((d) =>
          d
            .select()
            .from(SessionTable)
            .where(and(eq(SessionTable.project_id, project.id), eq(SessionTable.parent_id, parentID)))
            .all(),
        )
        return rows.map(fromRow)
      })

      const remove: (sessionID: SessionID) => Effect.Effect<void> = Effect.fnUntraced(function* (sessionID: SessionID) {
        try {
          const session = yield* get(sessionID)
          const kids = yield* children(sessionID)
          for (const child of kids) {
            yield* remove(child.id)
          }
          yield* unshare(sessionID).pipe(Effect.ignore)
          yield* Effect.sync(() => {
            SyncEvent.run(Event.Deleted, { sessionID, info: session })
            SyncEvent.remove(sessionID)
          })
        } catch (e) {
          log.error(e)
        }
      })

      const updateMessage = Effect.fn("Session.updateMessage")(function* (msg: MessageV2.Info) {
        yield* Effect.sync(() =>
          SyncEvent.run(MessageV2.Event.Updated, {
            sessionID: msg.sessionID,
            info: msg,
          }),
        )
        return msg
      })

      const updatePart = Effect.fn("Session.updatePart")(function* (part: MessageV2.Part) {
        yield* Effect.sync(() =>
          SyncEvent.run(MessageV2.Event.PartUpdated, {
            sessionID: part.sessionID,
            part: structuredClone(part),
            time: Date.now(),
          }),
        )
        return part
      })

      const create = Effect.fn("Session.create")(function* (input?: {
        parentID?: SessionID
        title?: string
        permission?: Permission.Ruleset
        workspaceID?: WorkspaceID
      }) {
        return yield* createNext({
          parentID: input?.parentID,
          directory: Instance.directory,
          title: input?.title,
          permission: input?.permission,
          workspaceID: input?.workspaceID,
        })
      })

      const fork = Effect.fn("Session.fork")(function* (input: { sessionID: SessionID; messageID?: MessageID }) {
        const original = yield* get(input.sessionID)
        const title = getForkedTitle(original.title)
        const session = yield* createNext({
          directory: Instance.directory,
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
        return yield* Effect.tryPromise(() => Storage.read<Snapshot.FileDiff[]>(["session_diff", sessionID])).pipe(
          Effect.orElseSucceed(() => [] as Snapshot.FileDiff[]),
        )
      })

      const messages = Effect.fn("Session.messages")(function* (input: { sessionID: SessionID; limit?: number }) {
        return yield* Effect.promise(async () => {
          const result = [] as MessageV2.WithParts[]
          for await (const msg of MessageV2.stream(input.sessionID)) {
            if (input.limit && result.length >= input.limit) break
            result.push(msg)
          }
          result.reverse()
          return result
        })
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

      const updatePartDelta = Effect.fn("Session.updatePartDelta")(function* (input: {
        sessionID: SessionID
        messageID: MessageID
        partID: PartID
        field: string
        delta: string
      }) {
        yield* bus.publish(MessageV2.Event.PartDelta, input)
      })

      const initialize = Effect.fn("Session.initialize")(function* (input: {
        sessionID: SessionID
        modelID: ModelID
        providerID: ProviderID
        messageID: MessageID
      }) {
        yield* Effect.promise(() =>
          SessionPrompt.command({
            sessionID: input.sessionID,
            messageID: input.messageID,
            model: input.providerID + "/" + input.modelID,
            command: Command.Default.INIT,
            arguments: "",
          }),
        )
      })

      return Service.of({
        create,
        fork,
        touch,
        get,
        share,
        unshare,
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
        updatePartDelta,
        initialize,
      })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Bus.layer), Layer.provide(Config.defaultLayer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export const create = fn(
    z
      .object({
        parentID: SessionID.zod.optional(),
        title: z.string().optional(),
        permission: Info.shape.permission,
        workspaceID: WorkspaceID.zod.optional(),
      })
      .optional(),
    (input) => runPromise((svc) => svc.create(input)),
  )

  export const fork = fn(z.object({ sessionID: SessionID.zod, messageID: MessageID.zod.optional() }), (input) =>
    runPromise((svc) => svc.fork(input)),
  )

  export const touch = fn(SessionID.zod, (id) => runPromise((svc) => svc.touch(id)))
  export const get = fn(SessionID.zod, (id) => runPromise((svc) => svc.get(id)))
  export const share = fn(SessionID.zod, (id) => runPromise((svc) => svc.share(id)))
  export const unshare = fn(SessionID.zod, (id) => runPromise((svc) => svc.unshare(id)))

  export const setTitle = fn(z.object({ sessionID: SessionID.zod, title: z.string() }), (input) =>
    runPromise((svc) => svc.setTitle(input)),
  )

  export const setArchived = fn(z.object({ sessionID: SessionID.zod, time: z.number().optional() }), (input) =>
    runPromise((svc) => svc.setArchived(input)),
  )

  export const setPermission = fn(z.object({ sessionID: SessionID.zod, permission: Permission.Ruleset }), (input) =>
    runPromise((svc) => svc.setPermission(input)),
  )

  export const setRevert = fn(
    z.object({ sessionID: SessionID.zod, revert: Info.shape.revert, summary: Info.shape.summary }),
    (input) =>
      runPromise((svc) => svc.setRevert({ sessionID: input.sessionID, revert: input.revert, summary: input.summary })),
  )

  export const clearRevert = fn(SessionID.zod, (id) => runPromise((svc) => svc.clearRevert(id)))

  export const setSummary = fn(z.object({ sessionID: SessionID.zod, summary: Info.shape.summary }), (input) =>
    runPromise((svc) => svc.setSummary({ sessionID: input.sessionID, summary: input.summary })),
  )

  export const diff = fn(SessionID.zod, (id) => runPromise((svc) => svc.diff(id)))

  export const messages = fn(z.object({ sessionID: SessionID.zod, limit: z.number().optional() }), (input) =>
    runPromise((svc) => svc.messages(input)),
  )

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
    if (input?.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
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

  export const children = fn(SessionID.zod, (id) => runPromise((svc) => svc.children(id)))
  export const remove = fn(SessionID.zod, (id) => runPromise((svc) => svc.remove(id)))
  export const updateMessage = fn(MessageV2.Info, (msg) => runPromise((svc) => svc.updateMessage(msg)))

  export const removeMessage = fn(z.object({ sessionID: SessionID.zod, messageID: MessageID.zod }), (input) =>
    runPromise((svc) => svc.removeMessage(input)),
  )

  export const removePart = fn(
    z.object({ sessionID: SessionID.zod, messageID: MessageID.zod, partID: PartID.zod }),
    (input) => runPromise((svc) => svc.removePart(input)),
  )

  export const updatePart = fn(MessageV2.Part, (part) => runPromise((svc) => svc.updatePart(part)))

  export const updatePartDelta = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
      field: z.string(),
      delta: z.string(),
    }),
    (input) => runPromise((svc) => svc.updatePartDelta(input)),
  )

  export const initialize = fn(
    z.object({ sessionID: SessionID.zod, modelID: ModelID.zod, providerID: ProviderID.zod, messageID: MessageID.zod }),
    (input) => runPromise((svc) => svc.initialize(input)),
  )
}
