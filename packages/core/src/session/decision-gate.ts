export * as SessionDecisionGate from "./decision-gate.js"

import type { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Config } from "../config.js"
import { Model } from "../model.js"
import { SessionCompaction } from "./compaction.js"
import { SessionContext } from "./context.js"
import type { SessionRunnerModel } from "./runner/model.js"

export type Kind = "chat" | "model"

export interface Decision {
  readonly kind: Kind
  readonly confidence: number
}

export interface Interface {
  /**
   * Returns the fast model for the first Step of a turn when routing is enabled and the newest user message is
   * confidently plain chat. Returns undefined to keep the primary model, which is always safe.
   */
  readonly route: (context: SessionContext.Loaded) => Effect.Effect<SessionRunnerModel.Resolved | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionDecisionGate") {}

// Only route when the request is comfortably inside the fast model's window, so routing never triggers compaction.
const WINDOW_SHARE = 0.5
const CHAT_CONFIDENCE = 0.95
const MAX_CHAT_LENGTH = 40

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const context = yield* SessionContext.Service
    const model = yield* Model.Service

    const fastModel = Effect.fn("SessionDecisionGate.fastModel")(function* (
      loaded: SessionContext.Loaded,
      gate: ConfigExperimental.DecisionGate,
    ) {
      const small = gate.model ? undefined : yield* model.small(loaded.model.ref.providerID)
      const ref = gate.model
        ? Model.Ref.make({
            providerID: gate.model.providerID,
            id: gate.model.model,
            ...(gate.model.variant ? { variant: gate.model.variant } : {}),
          })
        : small && Model.Ref.make({ providerID: small.providerID, id: small.id })
      if (!ref) return
      return yield* context.resolveModel({ ...loaded.session, model: ref }).pipe(Effect.orElseSucceed(() => undefined))
    })

    const route = Effect.fn("SessionDecisionGate.route")(function* (loaded: SessionContext.Loaded) {
      const gate = Config.latest(yield* config.entries(), "experimental")?.decision_gate
      if (!gate) return
      const latest = loaded.messages.at(-1)
      if (latest?.type !== "user") return
      const decision = decide(latest.text)
      yield* Effect.logInfo("decision gate decided", {
        sessionID: loaded.session.id,
        mode: gate.mode,
        kind: decision.kind,
        confidence: decision.confidence,
      })
      if (gate.mode !== "route" || decision.kind !== "chat") return
      const fast = yield* fastModel(loaded, gate)
      if (!fast || (fast.ref.providerID === loaded.model.ref.providerID && fast.ref.id === loaded.model.ref.id)) return
      const prompt = SessionCompaction.estimatePrompt({ ...loaded, model: fast })
      const window = fast.limit.input || fast.limit.context
      if (window > 0 && prompt.measured + prompt.estimated > window * WINDOW_SHARE) return
      yield* Effect.logInfo("decision gate routed step", { sessionID: loaded.session.id, model: fast.ref.id })
      return fast
    })

    return Service.of({ route })
  }),
)

const CHAT = new Set([
  "hi",
  "hello",
  "hey",
  "yo",
  "good morning",
  "good afternoon",
  "good evening",
  "thanks",
  "thank you",
  "thanks a lot",
  "thank you so much",
  "thx",
  "ty",
  "ok",
  "okay",
  "k",
  "cool",
  "great",
  "nice",
  "perfect",
  "awesome",
  "got it",
  "sounds good",
  "bye",
  "goodbye",
])

/**
 * Deterministic and instant: only greetings, thanks, and acknowledgements count as plain chat. Anything else, including
 * a greeting followed by a request, goes to the primary model.
 */
export function decide(text: string): Decision {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (text.trim().length > MAX_CHAT_LENGTH || !CHAT.has(normalized)) return { kind: "model", confidence: 1 }
  return { kind: "chat", confidence: CHAT_CONFIDENCE }
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, Model.node, SessionContext.node],
})
