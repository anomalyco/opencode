export * as VoiceLegacy from "./voice-legacy.js"

// Exists only for clients built before voice models were in the model list (iOS, Android, older desktop builds).
// Delete this file with the deprecated /voice/models and /voice/session endpoints.

import type { RealtimeSession, RealtimeTransportInput, RealtimeTransportType } from "@opencode/ai/experimental"
import { Effect } from "effect"
import { Model } from "./model.js"
import { Provider } from "./provider.js"
import { Voice } from "./voice.js"

export interface ModelInfo {
  readonly model: string
  readonly provider: string
  readonly transports: readonly RealtimeTransportType[]
  readonly available: boolean
}

export interface Models {
  readonly models: readonly ModelInfo[]
  readonly default?: string
}

export interface SessionInput {
  readonly model: string
  readonly session?: RealtimeSession
  readonly transport: RealtimeTransportInput
}

/** Old clients send a bare model ID: use the model on its protocol's own provider, else OpenCode's. */
function pick(models: readonly Model.Info[], id: string) {
  for (const model of models) {
    if (model.id === id && Voice.engineOf(model)?.provider === model.providerID) return model
  }
  for (const model of models) {
    if (model.id === id && model.providerID === Provider.ID.opencode) return model
  }
  return undefined
}

/**
 * One entry per voice model ID. Models of providers that can't start voice are listed as unavailable, so old clients
 * can tell a missing key from a server without voice.
 */
export const models = Effect.fn("VoiceLegacy.models")(function* () {
  const catalog = yield* Model.Service
  const providers = yield* Provider.Service
  const startable = yield* catalog.available(["realtime"])
  const known: Model.Info[] = [...startable]
  for (const record of (yield* providers.snapshot()).records.values()) {
    for (const model of record.models.values()) {
      if (Voice.engineOf(model)) known.push(model)
    }
  }

  const list: ModelInfo[] = []
  for (const model of known) {
    if (list.some((item) => item.model === model.id)) continue
    const usable = pick(startable, model.id)
    const picked = usable ?? pick(known, model.id)
    if (!picked) continue
    list.push({
      model: picked.id,
      provider: picked.providerID,
      transports: picked.realtime?.transports ?? [],
      available: usable !== undefined,
    })
  }
  // GPT-Live is the default when it can start, as it was before voice models came from the catalog.
  const live = startable.find((model) => model.realtime?.protocol === "openai-live")
  const first = live?.id ?? list.find((item) => item.available)?.model
  return first ? { models: list, default: first } : { models: list }
})

export const session = Effect.fn("VoiceLegacy.session")(function* (input: SessionInput) {
  const catalog = yield* Model.Service
  const voice = yield* Voice.Service
  const model = pick(yield* catalog.available(["realtime"]), input.model)
  if (!model) return yield* new Voice.UnavailableError({ message: Voice.missingKeyMessage })
  return yield* voice.connect({
    model: { id: model.id, providerID: model.providerID },
    session: input.session,
    transport: input.transport,
  })
})
