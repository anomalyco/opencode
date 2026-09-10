import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import type { SessionID } from "../schema"
import { Session } from "../session"
import { SessionClosureModel as Model } from "./model"
import type { SessionClosurePorts as Ports } from "./ports"
import { CLOSURE_RECORD_METADATA_KEY } from "@opencode-ai/core/session/closure-record"

/**
 * Resolves persisted identity from the newest real user message, then from Session metadata.
 * Resume admission is separate because it is not transcript state. The adapter stays downstream of
 * `Session` to avoid a `SessionClosure -> Session -> SessionClosure` layer cycle.
 */
export interface Interface extends Ports.PlanIdentityCapability {}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionClosureIdentity") {}

/**
 * Closure records carry `metadata.opencode.branch_closure`; excluding them prevents copied identity
 * from recursively becoming the next source.
 */
const closureRecord = (parts: readonly unknown[]) =>
  parts.some((part) => {
    if (!part || typeof part !== "object") return false
    const metadata = (part as { readonly metadata?: unknown }).metadata
    if (!metadata || typeof metadata !== "object") return false
    return CLOSURE_RECORD_METADATA_KEY in (metadata as Record<string, unknown>)
  })

/** Missing model fields reject a source; `{ present: false }` truthfully records no variant. */
const modelOf = (model: { readonly providerID?: string; readonly modelID?: string; readonly variant?: string }) => {
  if (typeof model.providerID !== "string" || typeof model.modelID !== "string") return undefined
  return {
    providerID: model.providerID,
    modelID: model.modelID,
    variant: typeof model.variant === "string" ? { present: true as const, value: model.variant } : { present: false as const },
  }
}

export type TranscriptView = readonly {
  readonly info: {
    readonly role: string
    readonly id?: string
    readonly agent?: string
    readonly model?: { readonly providerID?: string; readonly modelID?: string; readonly variant?: string }
  }
  readonly parts: readonly unknown[]
}[]

/** A Session stores its model identifier as `model.id`, unlike a Message's `model.modelID`. */
export type SessionView = {
  readonly agent?: string
  readonly model?: { readonly id?: string; readonly providerID?: string; readonly variant?: string }
}

export const select = (transcript: TranscriptView, session: SessionView | undefined): Model.Identity | undefined => {
  // Ignore user messages whose Parts contain `metadata.opencode.branch_closure`.
  const prior = transcript.findLast((message) => message.info.role === "user" && !closureRecord(message.parts))
  const priorModel = prior ? modelOf(prior.info.model ?? {}) : undefined
  if (prior && priorModel && typeof prior.info.agent === "string" && typeof prior.info.id === "string")
    return {
      source: "prior_user_message",
      // Only message-derived identity carries the exact source turn.
      sourceMessage: Model.id("message", prior.info.id),
      agent: prior.info.agent,
      model: priorModel,
    }

  // Session identity is used only when all stored fields are present; live defaults are never mixed in.
  const sessionModel = session
    ? modelOf({ providerID: session.model?.providerID, modelID: session.model?.id, variant: session.model?.variant })
    : undefined
  if (session && sessionModel && typeof session.agent === "string")
    return {
      source: "session_identity",
      agent: session.agent,
      model: sessionModel,
    }

  // The model turns absence into planning failure before allocating record coordinates.
  return undefined
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service

    /** Each persisted read degrades independently so missing identity is not reported as a worker defect. */
    const identityOf = (session: Model.SessionID) =>
      Effect.gen(function* () {
        const id = String(session) as SessionID
        const messages = yield* sessions.messages({ sessionID: id }).pipe(Effect.orElseSucceed(() => []))
        const info = yield* sessions.get(id).pipe(Effect.option)
        return select(messages, info._tag === "Some" ? info.value : undefined)
      })

    return Service.of({
      resolve: (targets) =>
        Effect.forEach(targets, (target) => identityOf(target).pipe(Effect.map((identity) => ({ session: target, identity }))), {
          concurrency: "unbounded",
        }),
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Session.node] })

export * as SessionClosureIdentity from "./identity"
