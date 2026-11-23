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
 * One entry per voice model ID, newest first. Models of providers that can't start voice are listed as unavailable, so
 * old clients can tell a missing key from a server without voice.
 */
const list = Effect.fnUntraced(function* () {
  const catalog = yield* Model.Service
  const providers = yield* Provider.Service
  const startable = yield* catalog.available(["realtime"])
  const others: Model.Info[] = []
  for (const record of (yield* providers.snapshot()).records.values()) {
    for (const model of record.models.values()) {
      if (Voice.engineOf(model)) others.push(model)
    }
  }
  others.sort((left, right) => right.time.released - left.time.released)
  const known = [...startable, ...others]

  const result: ModelInfo[] = []
  for (const model of known) {
    if (result.some((item) => item.model === model.id)) continue
    const usable = pick(startable, model.id)
    const picked = usable ?? pick(known, model.id)
    if (!picked) continue
    result.push({
      model: picked.id,
      provider: picked.providerID,
      transports: picked.realtime?.transports ?? [],
      available: usable !== undefined,
    })
  }
  return result
})

export const models = Effect.fn("VoiceLegacy.models")(function* () {
  const result = yield* list()
  const first = result.find((item) => item.available)?.model
  return first ? { models: result, default: first } : { models: result }
})

export const session = Effect.fn("VoiceLegacy.session")(function* (input: SessionInput) {
  const voice = yield* Voice.Service
  const result = yield* list()
  const item = result.find((entry) => entry.model === input.model)
  if (!item)
    return yield* new Voice.InvalidRequestError({
      message: `Unsupported voice model: ${input.model}. This server lists ${result.map((entry) => entry.model).join(", ") || "none"}.`,
    })
  if (!item.available) return yield* new Voice.UnavailableError({ message: Voice.missingKeyMessage })
  return yield* voice
    .connect({
      model: { id: Model.ID.make(item.model), providerID: Provider.ID.make(item.provider) },
      session: input.session,
      transport: input.transport,
    })
    .pipe(
      // This endpoint never answered 404 or 422: a model it can't start needs a key.
      Effect.mapError((error) =>
        error._tag === "Voice.InvalidRequestError" || error._tag === "Voice.UnavailableError"
          ? error
          : new Voice.UnavailableError({ message: Voice.missingKeyMessage }),
      ),
    )
})
