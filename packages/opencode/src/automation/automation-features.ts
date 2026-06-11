import { Effect, Layer, Ref, Context } from "effect"
import { PatternDetection } from "../pattern-detection/pattern-detection"
import { AutoReply } from "../auto-reply/auto-reply"

export interface AutomationFeaturesConfig {
  enabled: boolean
  autoReply: {
    enabled: boolean
    phrases: string[]
    triggerPhrases: string[]
    responseDelay: number
    maxResponses: number
    cooldownPeriod: number
  }
  patternDetection: {
    enabled: boolean
    maxRepetitions: number
    timeWindow: number
    similarityThreshold: number
  }
  scheduler: {
    enabled: boolean
  }
}

export interface Interface {
  readonly detectAndHandleLoop: (text: string, toolUsage?: string) => Effect.Effect<boolean>
  readonly shouldAutoReply: (text: string) => Effect.Effect<boolean>
  readonly generateAutoReply: () => Effect.Effect<string>
  readonly getConfig: () => Effect.Effect<AutomationFeaturesConfig>
  readonly updateConfig: (config: Partial<AutomationFeaturesConfig>) => Effect.Effect<void>
  readonly resetAll: () => Effect.Effect<void>
}

const defaultConfig: AutomationFeaturesConfig = {
  enabled: false,
  autoReply: {
    enabled: false,
    phrases: ["continue", "go on", "do it", "ok, do it", "proceed", "keep going", "next step", "carry on"],
    triggerPhrases: [
      "next steps", "what next", "continue with", "proceed with",
      "moving forward", "to continue", "further steps", "what should", "how to proceed",
    ],
    responseDelay: 1000,
    maxResponses: 10,
    cooldownPeriod: 30 * 1000,
  },
  patternDetection: {
    enabled: false,
    maxRepetitions: 5,
    timeWindow: 5 * 60 * 1000,
    similarityThreshold: 0.7,
  },
  scheduler: { enabled: false },
}

const make = Effect.gen(function* () {
  const config = yield* Ref.make<AutomationFeaturesConfig>(defaultConfig)
  const pd = yield* PatternDetection.Service
  const ar = yield* AutoReply.Service

  const detectAndHandleLoop = (text: string, toolUsage?: string): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const cfg = yield* Ref.get(config)
      if (!cfg.enabled || !cfg.patternDetection.enabled) return false
      return yield* pd.detectPattern(text, toolUsage)
    })

  const shouldAutoReply = (text: string): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const cfg = yield* Ref.get(config)
      if (!cfg.enabled || !cfg.autoReply.enabled) return false
      return yield* ar.shouldAutoReply(text)
    })

  const generateAutoReply = (): Effect.Effect<string> =>
    Effect.gen(function* () {
      const cfg = yield* Ref.get(config)
      if (!cfg.enabled || !cfg.autoReply.enabled) return ""
      return yield* ar.generateReply()
    })

  const getConfig = (): Effect.Effect<AutomationFeaturesConfig> => Ref.get(config)

  const updateConfig = (partial: Partial<AutomationFeaturesConfig>): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Ref.update(config, (c) => ({ ...c, ...partial }))
      if (partial.autoReply) yield* ar.updateConfig(partial.autoReply)
      if (partial.patternDetection) yield* pd.updateConfig(partial.patternDetection)
    })

  const resetAll = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* pd.reset()
      yield* ar.resetStats()
    })

  return { detectAndHandleLoop, shouldAutoReply, generateAutoReply, getConfig, updateConfig, resetAll } satisfies Interface
})

export class Service extends Context.Service<Service, Interface>()("@opencode/AutomationFeatures") {}

export const layer = Layer.effect(Service, make).pipe(
  Layer.provide(PatternDetection.layer),
  Layer.provide(AutoReply.layer),
)
export const defaultLayer = layer

export * as AutomationFeatures from "./automation-features"
