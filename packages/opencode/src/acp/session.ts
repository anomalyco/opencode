import type { McpServer } from "@agentclientprotocol/sdk"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import { Context, Effect, Layer, Ref } from "effect"
import type { ModelID, ProviderID } from "../provider/schema"
import * as ACPError from "./error"

export type SelectedModel = {
  providerID: ProviderID
  modelID: ModelID
}

export type KnownMessagePartMetadata = {
  messageId: string
  partId: string
  partType?: Part["type"]
  role?: Message["role"]
  ignored?: boolean
  toolCallId?: string
  metadata?: unknown
}

export type Info = {
  id: string
  cwd: string
  mcpServers: readonly McpServer[]
  createdAt: Date
  model?: SelectedModel
  variant?: string
  modeId?: string
  knownParts: ReadonlyMap<string, KnownMessagePartMetadata>
}

export type StoreInput = {
  id: string
  cwd: string
  mcpServers?: readonly McpServer[]
  createdAt?: Date
  model?: SelectedModel
  variant?: string
  modeId?: string
}

export type RecordPartMetadataInput = {
  sessionId: string
  messageId: string
  partId: string
  partType?: Part["type"]
  role?: Message["role"]
  ignored?: boolean
  toolCallId?: string
  metadata?: unknown
}

export type PartMetadataLookupInput = {
  sessionId: string
  messageId: string
  partId: string
}

export type Interface = {
  readonly create: (input: StoreInput) => Effect.Effect<Info>
  readonly load: (input: StoreInput) => Effect.Effect<Info>
  readonly list: (cwd?: string) => Effect.Effect<readonly Info[]>
  readonly get: (sessionId: string) => Effect.Effect<Info, ACPError.SessionNotFoundError>
  readonly tryGet: (sessionId: string) => Effect.Effect<Info | undefined>
  readonly remove: (sessionId: string) => Effect.Effect<Info | undefined>
  readonly setModel: (
    sessionId: string,
    model: SelectedModel | undefined,
  ) => Effect.Effect<Info, ACPError.SessionNotFoundError>
  readonly getModel: (sessionId: string) => Effect.Effect<SelectedModel | undefined, ACPError.SessionNotFoundError>
  readonly setVariant: (
    sessionId: string,
    variant: string | undefined,
  ) => Effect.Effect<Info, ACPError.SessionNotFoundError>
  readonly getVariant: (sessionId: string) => Effect.Effect<string | undefined, ACPError.SessionNotFoundError>
  readonly setMode: (
    sessionId: string,
    modeId: string | undefined,
  ) => Effect.Effect<Info, ACPError.SessionNotFoundError>
  readonly getMode: (sessionId: string) => Effect.Effect<string | undefined, ACPError.SessionNotFoundError>
  readonly recordPartMetadata: (
    input: RecordPartMetadataInput,
  ) => Effect.Effect<KnownMessagePartMetadata, ACPError.SessionNotFoundError>
  readonly getPartMetadata: (
    input: PartMetadataLookupInput,
  ) => Effect.Effect<KnownMessagePartMetadata | undefined, ACPError.SessionNotFoundError>
  readonly tryGetPartMetadata: (input: PartMetadataLookupInput) => Effect.Effect<KnownMessagePartMetadata | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ACP/Session") {}

type State = Map<string, Info>

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Ref.make<State>(new Map())

    const store = Effect.fn("ACP.Session.store")(function* (input: StoreInput) {
      const session = makeSession(input)
      yield* Ref.update(sessions, (state) => new Map(state).set(session.id, session))
      return snapshot(session)
    })

    const tryGet = Effect.fn("ACP.Session.tryGet")(function* (sessionId: string) {
      const session = (yield* Ref.get(sessions)).get(sessionId)
      if (!session) return
      return snapshot(session)
    })

    const get = Effect.fn("ACP.Session.get")(function* (sessionId: string) {
      const session = yield* tryGet(sessionId)
      if (session) return session
      return yield* new ACPError.SessionNotFoundError({ sessionId })
    })

    const update = Effect.fn("ACP.Session.update")(function* (sessionId: string, fn: (session: Info) => Info) {
      const result = yield* Ref.modify(sessions, (state) => {
        const session = state.get(sessionId)
        if (!session) return [undefined, state] as const
        const next = fn(session)
        return [snapshot(next), new Map(state).set(sessionId, next)] as const
      })
      if (result) return result
      return yield* new ACPError.SessionNotFoundError({ sessionId })
    })

    const remove = Effect.fn("ACP.Session.remove")(function* (sessionId: string) {
      return yield* Ref.modify(sessions, (state) => {
        const session = state.get(sessionId)
        if (!session) return [undefined, state] as const
        const next = new Map(state)
        next.delete(sessionId)
        return [snapshot(session), next] as const
      })
    })

    const setModel: Interface["setModel"] = Effect.fn("ACP.Session.setModel")((sessionId, model) =>
      update(sessionId, (session) => ({ ...session, model })),
    )

    const setVariant: Interface["setVariant"] = Effect.fn("ACP.Session.setVariant")((sessionId, variant) =>
      update(sessionId, (session) => ({ ...session, variant })),
    )

    const setMode: Interface["setMode"] = Effect.fn("ACP.Session.setMode")((sessionId, modeId) =>
      update(sessionId, (session) => ({ ...session, modeId })),
    )

    const recordPartMetadata: Interface["recordPartMetadata"] = Effect.fn("ACP.Session.recordPartMetadata")((
      input,
    ) => {
      const metadata = {
        messageId: input.messageId,
        partId: input.partId,
        partType: input.partType,
        role: input.role,
        ignored: input.ignored,
        toolCallId: input.toolCallId,
        metadata: input.metadata,
      }
      return update(input.sessionId, (session) => ({
        ...session,
        knownParts: new Map(session.knownParts).set(partMetadataKey(input), metadata),
      })).pipe(Effect.as(metadata))
    })

    return Service.of({
      create: store,
      load: store,
      list: Effect.fn("ACP.Session.list")(function* (cwd?: string) {
        return [...(yield* Ref.get(sessions)).values()]
          .filter((session) => !cwd || session.cwd === cwd)
          .map(snapshot)
          .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      }),
      get,
      tryGet,
      remove,
      setModel,
      getModel: Effect.fn("ACP.Session.getModel")(function* (sessionId) {
        return (yield* get(sessionId)).model
      }),
      setVariant,
      getVariant: Effect.fn("ACP.Session.getVariant")(function* (sessionId) {
        return (yield* get(sessionId)).variant
      }),
      setMode,
      getMode: Effect.fn("ACP.Session.getMode")(function* (sessionId) {
        return (yield* get(sessionId)).modeId
      }),
      recordPartMetadata,
      getPartMetadata: Effect.fn("ACP.Session.getPartMetadata")(function* (input) {
        return (yield* get(input.sessionId)).knownParts.get(partMetadataKey(input))
      }),
      tryGetPartMetadata: Effect.fn("ACP.Session.tryGetPartMetadata")(function* (input) {
        return (yield* tryGet(input.sessionId))?.knownParts.get(partMetadataKey(input))
      }),
    })
  }),
)

export const defaultLayer = layer

function makeSession(input: StoreInput): Info {
  return {
    id: input.id,
    cwd: input.cwd,
    mcpServers: [...(input.mcpServers ?? [])],
    createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
    model: input.model,
    variant: input.variant,
    modeId: input.modeId,
    knownParts: new Map(),
  }
}

function snapshot(session: Info): Info {
  return {
    ...session,
    mcpServers: [...session.mcpServers],
    createdAt: new Date(session.createdAt),
    knownParts: new Map(session.knownParts),
  }
}

function partMetadataKey(input: { messageId: string; partId: string }) {
  return `${input.messageId}:${input.partId}`
}

export * as ACPSession from "./session"
