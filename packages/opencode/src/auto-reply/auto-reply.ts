import { Effect, Layer, Ref, Context } from "effect"

export interface AutoReplyConfig {
  enabled: boolean
  phrases: string[]
  triggerPhrases: string[]
  responseDelay: number
  maxResponses: number
  cooldownPeriod: number
}

export interface AutoReplyStats {
  totalReplies: number
  lastReplyAt: number | null
}

export interface Interface {
  readonly shouldAutoReply: (text: string) => Effect.Effect<boolean>
  readonly generateReply: () => Effect.Effect<string>
  readonly updateConfig: (config: Partial<AutoReplyConfig>) => Effect.Effect<void>
  readonly resetStats: () => Effect.Effect<void>
  readonly getConfig: () => Effect.Effect<AutoReplyConfig>
}

const defaultConfig: AutoReplyConfig = {
  enabled: false,
  phrases: ["continue", "go on", "do it", "ok, do it", "proceed", "keep going", "next step", "carry on"],
  triggerPhrases: [
    "next steps",
    "what next",
    "continue with",
    "proceed with",
    "moving forward",
    "to continue",
    "further steps",
    "what should",
    "how to proceed",
  ],
  responseDelay: 1000,
  maxResponses: 10,
  cooldownPeriod: 30 * 1000,
}

const make = Effect.gen(function* () {
  const config = yield* Ref.make<AutoReplyConfig>(defaultConfig)
  const stats = yield* Ref.make<AutoReplyStats>({ totalReplies: 0, lastReplyAt: null })

  const shouldAutoReply = (text: string) =>
    Effect.gen(function* () {
      const cfg = yield* Ref.get(config)
      if (!cfg.enabled) return false

      const st = yield* Ref.get(stats)
      if (st.totalReplies >= cfg.maxResponses) return false
      if (st.lastReplyAt !== null && Date.now() - st.lastReplyAt < cfg.cooldownPeriod) return false

      const lower = text.toLowerCase()
      return cfg.triggerPhrases.some((phrase) => lower.includes(phrase))
    })

  const generateReply = () =>
    Effect.gen(function* () {
      const cfg = yield* Ref.get(config)
      const phrase = cfg.phrases[Math.floor(Math.random() * cfg.phrases.length)] ?? "continue"
      yield* Ref.update(stats, (s) => ({ totalReplies: s.totalReplies + 1, lastReplyAt: Date.now() }))
      return phrase
    })

  const updateConfig = (partial: Partial<AutoReplyConfig>) =>
    Ref.update(config, (c) => ({ ...c, ...partial }))

  const resetStats = () => Ref.set(stats, { totalReplies: 0, lastReplyAt: null })

  const getConfig = () => Ref.get(config)

  return { shouldAutoReply, generateReply, updateConfig, resetStats, getConfig } satisfies Interface
})

export class Service extends Context.Service<Service, Interface>()("@opencode/AutoReply") {}

export const layer = Layer.effect(Service, make)
export const defaultLayer = layer

export * as AutoReply from "./auto-reply"
