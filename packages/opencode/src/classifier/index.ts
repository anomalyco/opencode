import { Effect } from "effect"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { isSafeAllowlisted } from "./allowlist"
import { resolvePolicy } from "./prompt"
import { ownModelProvider } from "./provider/own-model"
import { ogProvider } from "./provider/og"
import { buildTranscript, projectToolInput } from "./transcript"
import type { ClassifierDecision } from "./types"

const ALLOW: ClassifierDecision = { kind: "allow" }
const ask = (reason: string): ClassifierDecision => ({ kind: "ask", reason })
const block = (reason: string): ClassifierDecision => ({ kind: "block", reason })

// Escalation backstop: too many denials in one turn → escalate to the human.
const MAX_CONSECUTIVE_DENIALS = 3
const MAX_TOTAL_DENIALS = 20

// Default OpenGuardrails endpoints; override per backend via `classifier.endpoint`.
const OG_SAAS_ENDPOINT = "https://api.openguardrails.com"
const OG_LOCAL_ENDPOINT = "http://localhost:8000"

/**
 * Per-session denial counters. Reset when the latest user message changes
 * (i.e. on a new user turn). Keyed by sessionID.
 */
const counters = new Map<string, { lastUser: string; consecutive: number; total: number }>()

function lastUserId(messages: SessionV1.WithParts[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.info.role === "user") return messages[i]!.info.id
  }
  return ""
}

function parseModel(s: string): [ProviderV2.ID, ModelV2.ID] {
  const i = s.indexOf("/")
  return i === -1
    ? [ProviderV2.ID.make(s), ModelV2.ID.make(s)]
    : [ProviderV2.ID.make(s.slice(0, i)), ModelV2.ID.make(s.slice(i + 1))]
}

/**
 * Decide whether a would-auto-approve tool call should proceed, be blocked
 * (deny-and-continue), or be escalated to the human (`ask`).
 *
 * Returns `undefined` when the classifier is disabled or the tool is on the
 * safe allowlist — the caller then proceeds exactly as today (no gating).
 *
 * Fails CLOSED: any backend error / unparseable response → `ask`.
 *
 * Requires `Config` + `Provider`; the call site runs this through the request
 * EffectBridge so the captured context provides them (the thunk stays R=never).
 */
export const evaluate = Effect.fn("Classifier.evaluate")(function* (input: {
  tool: string
  toolInput: unknown
  messages: SessionV1.WithParts[]
  fallbackModel: Provider.Model
  sessionID: string
  abort: AbortSignal
}) {
  const cfg = (yield* (yield* Config.Service).get()).classifier
  if (!cfg?.enabled) return undefined
  if (isSafeAllowlisted(input.tool)) return undefined

  const backend = cfg.backend ?? "own"

  // Counter state, reset on a new user turn.
  const sid = input.sessionID
  const lu = lastUserId(input.messages)
  const c = counters.get(sid) ?? { lastUser: lu, consecutive: 0, total: 0 }
  if (c.lastUser !== lu) {
    c.lastUser = lu
    c.consecutive = 0
    c.total = 0
  }

  const policy = resolvePolicy(cfg)
  const classifierInput = {
    transcript: buildTranscript(input.messages),
    action: { tool: input.tool, input: projectToolInput(input.tool, input.toolInput) },
    policy,
  }

  const verdict = yield* Effect.gen(function* () {
    // og-saas / og-local: POST the contract to the OpenGuardrails service.
    if (backend === "og-saas" || backend === "og-local") {
      const endpoint = cfg.endpoint ?? (backend === "og-saas" ? OG_SAAS_ENDPOINT : OG_LOCAL_ENDPOINT)
      const p = ogProvider({ endpoint, apiKey: cfg.apiKey, label: backend })
      return yield* Effect.promise(() => p.classify(classifierInput, input.abort))
    }
    // own: the user's configured model via the AI SDK.
    const provider = yield* Provider.Service
    let model: Provider.Model
    if (cfg.model) {
      const [providerID, modelID] = parseModel(cfg.model)
      model = yield* provider.getModel(providerID, modelID)
    } else {
      model = input.fallbackModel
    }
    const language = yield* provider.getLanguage(model)
    const p = ownModelProvider(language, `${model.providerID}/${model.id}`)
    return yield* Effect.promise(() => p.classify(classifierInput, input.abort))
  }).pipe(
    Effect.catch((e) =>
      Effect.succeed({
        shouldBlock: true,
        unavailable: true,
        reason: e instanceof Error ? e.message : String(e),
        model: backend,
      }),
    ),
  )

  if (verdict.unavailable) {
    counters.set(sid, c)
    return ask(verdict.reason ?? "classifier unavailable")
  }
  if (verdict.shouldBlock) {
    c.consecutive += 1
    c.total += 1
    counters.set(sid, c)
    if (c.consecutive >= MAX_CONSECUTIVE_DENIALS || c.total >= MAX_TOTAL_DENIALS) {
      return ask("Repeated classifier denials this turn — escalating to you for review.")
    }
    return block(verdict.reason ?? "blocked by the command-approval classifier")
  }
  c.consecutive = 0
  counters.set(sid, c)
  return ALLOW
})

export * as Classifier from "./index"
