import { ConfigPermission } from "@/config/permission"
import { InstanceState } from "@/effect/instance-state"
import { ProjectV2 } from "@opencode-ai/core/project"
import { MessageID, SessionID } from "@/session/schema"
import { PermissionTable } from "@opencode-ai/core/session/sql"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import * as Log from "@opencode-ai/core/util/log"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { Deferred, Effect, Layer, Option, Schema, Context } from "effect"
import os from "os"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PermissionID } from "./schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"

const log = Log.create({ service: "permission" })

export const Action = PermissionV2.Action.annotate({ identifier: "PermissionAction" })
export type Action = Schema.Schema.Type<typeof Action>

export const Rule = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.String,
  action: Action,
}).annotate({ identifier: "PermissionRule" })
export type Rule = Schema.Schema.Type<typeof Rule>

export const Ruleset = Schema.Array(Rule).annotate({ identifier: "PermissionRuleset" })
export type Ruleset = Schema.Schema.Type<typeof Ruleset>

const MetadataFile = Schema.Struct({
  filePath: Schema.String,
  relativePath: Schema.String,
  type: Schema.String,
  patch: Schema.String,
  additions: Schema.Finite,
  deletions: Schema.Finite,
  movePath: Schema.optional(Schema.String),
})

export const Metadata = Schema.Struct({
  filepath: Schema.optional(Schema.String),
  diff: Schema.optional(Schema.String),
  files: Schema.optional(Schema.Array(MetadataFile)),
  parentDir: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  format: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Finite),
  query: Schema.optional(Schema.String),
  numResults: Schema.optional(Schema.Finite),
  livecrawl: Schema.optional(Schema.Boolean),
  type: Schema.optional(Schema.String),
  contextMaxCharacters: Schema.optional(Schema.Finite),
  provider: Schema.optional(Schema.String),
  repository: Schema.optional(Schema.String),
  remote: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  refresh: Schema.optional(Schema.Boolean),
  branch: Schema.optional(Schema.String),
  depth: Schema.optional(Schema.Finite),
  pattern: Schema.optional(Schema.String),
  include: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  subagent_type: Schema.optional(Schema.String),
  operation: Schema.optional(Schema.String),
  filePath: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Finite),
  character: Schema.optional(Schema.Finite),
  input: Schema.optional(Schema.Json),
}).annotate({ identifier: "PermissionMetadata" })
type Metadata = Schema.Schema.Type<typeof Metadata>

// Pure data; nothing checks class identity. As `Schema.Struct` + type alias,
// `Permission.ask` can trust its already-typed input and skip the inner
// `decodeUnknownSync` that would otherwise throw uncaught on any structural
// mismatch. Same pattern as `Question.Request` in PR #28570.
export const Request = Schema.Struct({
  id: PermissionID,
  sessionID: SessionID,
  permission: Schema.String,
  patterns: Schema.Array(Schema.String),
  metadata: Metadata,
  always: Schema.Array(Schema.String),
  tool: Schema.optional(
    Schema.Struct({
      messageID: MessageID,
      callID: Schema.String,
    }),
  ),
}).annotate({ identifier: "PermissionRequest" })
type WireRequest = Schema.Schema.Type<typeof Request>
export type Request = Omit<WireRequest, "metadata"> & {
  metadata: Readonly<Record<string, unknown>>
}

export const Reply = Schema.Literals(["once", "always", "reject"])
export type Reply = Schema.Schema.Type<typeof Reply>

const reply = {
  reply: Reply,
  message: Schema.optional(Schema.String),
}

export const ReplyBody = Schema.Struct(reply).annotate({ identifier: "PermissionReplyBody" })
export type ReplyBody = Schema.Schema.Type<typeof ReplyBody>

export const Approval = Schema.Struct({
  projectID: ProjectV2.ID,
  patterns: Schema.Array(Schema.String),
}).annotate({ identifier: "PermissionApproval" })
export type Approval = Schema.Schema.Type<typeof Approval>

export const Event = {
  Asked: EventV2.define({ type: "permission.asked", schema: Request.fields }),
  Replied: EventV2.define({
    type: "permission.replied",
    schema: {
      sessionID: SessionID,
      requestID: PermissionID,
      reply: Reply,
    },
  }),
}

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("PermissionRejectedError", {}) {
  override get message() {
    return "The user rejected permission to use this specific tool call."
  }
}

export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()("PermissionCorrectedError", {
  feedback: Schema.String,
}) {
  override get message() {
    return `The user rejected permission to use this specific tool call with the following feedback: ${this.feedback}`
  }
}

export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()("PermissionDeniedError", {
  ruleset: Schema.Any,
}) {
  override get message() {
    return `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(this.ruleset)}`
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Permission.NotFoundError", {
  requestID: PermissionID,
}) {}

export type Error = DeniedError | RejectedError | CorrectedError

export const AskInput = Schema.Struct({
  ...Request.fields,
  id: Schema.optional(PermissionID),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  ruleset: Ruleset,
}).annotate({ identifier: "PermissionAskInput" })
export type AskInput = Schema.Schema.Type<typeof AskInput>

export const ReplyInput = Schema.Struct({
  requestID: PermissionID,
  ...reply,
}).annotate({ identifier: "PermissionReplyInput" })
export type ReplyInput = Schema.Schema.Type<typeof ReplyInput>

export interface Interface {
  readonly ask: (input: AskInput) => Effect.Effect<void, Error>
  readonly reply: (input: ReplyInput) => Effect.Effect<void, NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<WireRequest>>
}

interface PendingEntry {
  info: WireRequest
  deferred: Deferred.Deferred<void, RejectedError | CorrectedError>
}

interface State {
  pending: Map<PermissionID, PendingEntry>
  approved: Rule[]
}

export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  return PermissionV2.evaluate(permission, pattern, ...rulesets)
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Permission") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("Permission.state")(function* (ctx) {
        const row = yield* db
          .select()
          .from(PermissionTable)
          .where(eq(PermissionTable.project_id, ctx.project.id))
          .get()
          .pipe(Effect.orDie)
        const state = {
          pending: new Map<PermissionID, PendingEntry>(),
          approved: [...(row?.data ?? [])],
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new RejectedError())
            }
            state.pending.clear()
          }),
        )

        return state
      }),
    )

    const ask = Effect.fn("Permission.ask")(function* (input: AskInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const { ruleset, ...request } = input
      let needsAsk = false

      for (const pattern of request.patterns) {
        const rule = evaluate(request.permission, pattern, ruleset, approved)
        log.info("evaluated", { permission: request.permission, pattern, action: rule })
        if (rule.action === "deny") {
          return yield* new DeniedError({
            ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
          })
        }
        if (rule.action === "allow") continue
        needsAsk = true
      }

      if (!needsAsk) return

      const id = request.id ?? PermissionID.ascending()
      const info: WireRequest = {
        id,
        sessionID: request.sessionID,
        permission: request.permission,
        patterns: request.patterns,
        metadata: normalizeMetadata(request.metadata),
        always: request.always,
        tool: request.tool,
      }
      log.info("asking", { id, permission: info.permission, patterns: info.patterns })

      const deferred = yield* Deferred.make<void, RejectedError | CorrectedError>()
      pending.set(id, { info, deferred })
      yield* events.publish(Event.Asked, info)
      return yield* Effect.ensuring(
        Deferred.await(deferred),
        Effect.sync(() => {
          pending.delete(id)
        }),
      )
    })

    const reply = Effect.fn("Permission.reply")(function* (input: ReplyInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const existing = pending.get(input.requestID)
      if (!existing) return yield* new NotFoundError({ requestID: input.requestID })

      pending.delete(input.requestID)
      yield* events.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
      })

      if (input.reply === "reject") {
        yield* Deferred.fail(
          existing.deferred,
          input.message ? new CorrectedError({ feedback: input.message }) : new RejectedError(),
        )

        for (const [id, item] of pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) continue
          pending.delete(id)
          yield* events.publish(Event.Replied, {
            sessionID: item.info.sessionID,
            requestID: item.info.id,
            reply: "reject",
          })
          yield* Deferred.fail(item.deferred, new RejectedError())
        }
        return
      }

      yield* Deferred.succeed(existing.deferred, undefined)
      if (input.reply === "once") return

      for (const pattern of existing.info.always) {
        approved.push({
          permission: existing.info.permission,
          pattern,
          action: "allow",
        })
      }

      for (const [id, item] of pending.entries()) {
        if (item.info.sessionID !== existing.info.sessionID) continue
        const ok = item.info.patterns.every(
          (pattern) => evaluate(item.info.permission, pattern, approved).action === "allow",
        )
        if (!ok) continue
        pending.delete(id)
        yield* events.publish(Event.Replied, {
          sessionID: item.info.sessionID,
          requestID: item.info.id,
          reply: "always",
        })
        yield* Deferred.succeed(item.deferred, undefined)
      }
    })

    const list = Effect.fn("Permission.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (item) => item.info)
    })

    return Service.of({ ask, reply, list })
  }),
)

function expand(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
  return pattern
}

function normalizeMetadata(metadata: Readonly<Record<string, unknown>>): Metadata {
  const filepath = decodeStringMetadata(metadata.filepath)
  const diff = decodeStringMetadata(metadata.diff)
  const files = decodeFilesMetadata(metadata.files)
  const parentDir = decodeStringMetadata(metadata.parentDir)
  const url = decodeStringMetadata(metadata.url)
  const format = decodeStringMetadata(metadata.format)
  const timeout = decodeFiniteMetadata(metadata.timeout)
  const query = decodeStringMetadata(metadata.query)
  const numResults = decodeFiniteMetadata(metadata.numResults)
  const livecrawl = decodeBooleanMetadata(metadata.livecrawl)
  const type = decodeStringMetadata(metadata.type)
  const contextMaxCharacters = decodeFiniteMetadata(metadata.contextMaxCharacters)
  const provider = decodeStringMetadata(metadata.provider)
  const repository = decodeStringMetadata(metadata.repository)
  const remote = decodeStringMetadata(metadata.remote)
  const path = decodeStringMetadata(metadata.path)
  const refresh = decodeBooleanMetadata(metadata.refresh)
  const branch = decodeStringMetadata(metadata.branch)
  const depth = decodeFiniteMetadata(metadata.depth)
  const pattern = decodeStringMetadata(metadata.pattern)
  const include = decodeStringMetadata(metadata.include)
  const description = decodeStringMetadata(metadata.description)
  const subagent_type = decodeStringMetadata(metadata.subagent_type)
  const operation = decodeStringMetadata(metadata.operation)
  const filePath = decodeStringMetadata(metadata.filePath)
  const line = decodeFiniteMetadata(metadata.line)
  const character = decodeFiniteMetadata(metadata.character)
  const input = toJson(metadata.input, new WeakSet<object>())

  return {
    ...(filepath !== undefined ? { filepath } : {}),
    ...(diff !== undefined ? { diff } : {}),
    ...(files !== undefined ? { files } : {}),
    ...(parentDir !== undefined ? { parentDir } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(format !== undefined ? { format } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    ...(query !== undefined ? { query } : {}),
    ...(numResults !== undefined ? { numResults } : {}),
    ...(livecrawl !== undefined ? { livecrawl } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(contextMaxCharacters !== undefined ? { contextMaxCharacters } : {}),
    ...(provider !== undefined ? { provider } : {}),
    ...(repository !== undefined ? { repository } : {}),
    ...(remote !== undefined ? { remote } : {}),
    ...(path !== undefined ? { path } : {}),
    ...(refresh !== undefined ? { refresh } : {}),
    ...(branch !== undefined ? { branch } : {}),
    ...(depth !== undefined ? { depth } : {}),
    ...(pattern !== undefined ? { pattern } : {}),
    ...(include !== undefined ? { include } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(subagent_type !== undefined ? { subagent_type } : {}),
    ...(operation !== undefined ? { operation } : {}),
    ...(filePath !== undefined ? { filePath } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(character !== undefined ? { character } : {}),
    ...(input !== undefined ? { input } : {}),
  }
}

const decodeString = Schema.decodeUnknownOption(Schema.String)
const decodeBoolean = Schema.decodeUnknownOption(Schema.Boolean)
const decodeFinite = Schema.decodeUnknownOption(Schema.Finite)
const decodeFiles = Schema.decodeUnknownOption(Schema.Array(MetadataFile))

function decodeStringMetadata(value: unknown) {
  return decodeMetadataValue(decodeString, value)
}

function decodeBooleanMetadata(value: unknown) {
  return decodeMetadataValue(decodeBoolean, value)
}

function decodeFiniteMetadata(value: unknown) {
  return decodeMetadataValue(decodeFinite, value)
}

function decodeFilesMetadata(value: unknown) {
  return decodeMetadataValue(decodeFiles, value)
}

function decodeMetadataValue<Value>(decode: (input: unknown) => Option.Option<Value>, value: unknown) {
  const json = toJson(value, new WeakSet<object>())
  if (json === undefined) return undefined
  return Option.getOrUndefined(decode(json))
}

function toJson(value: unknown, seen: WeakSet<object>): Schema.Schema.Type<typeof Schema.Json> | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === "string") return value
  if (typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "bigint") return undefined
  if (typeof value === "function") return undefined
  if (typeof value === "symbol") return undefined
  if (seen.has(value)) return undefined

  seen.add(value)
  const json = Array.isArray(value)
    ? value.map((item) => toJson(item, seen) ?? null)
    : Object.fromEntries(
        Object.entries(value).flatMap(([key, item]) => {
          const json = toJson(item, seen)
          if (json === undefined) return []
          return [[key, json]]
        }),
      )
  seen.delete(value)
  return json
}

export function fromConfig(permission: ConfigPermission.Info) {
  const ruleset: Rule[] = []
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      ruleset.push({ permission: key, action: value, pattern: "*" })
      continue
    }
    ruleset.push(
      ...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern: expand(pattern), action })),
    )
  }
  return ruleset
}

export function merge(...rulesets: Ruleset[]): Rule[] {
  return [...PermissionV2.merge(...rulesets)]
}

export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
  return PermissionV2.disabled(tools, ruleset)
}

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer), Layer.provide(EventV2Bridge.defaultLayer))

export * as Permission from "."
