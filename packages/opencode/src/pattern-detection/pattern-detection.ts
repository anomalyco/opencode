import { Effect, Layer, Ref, Context } from "effect"

export interface PatternDetectionConfig {
  enabled: boolean
  maxRepetitions: number
  timeWindow: number
  similarityThreshold: number
}

export interface Interface {
  readonly detectPattern: (text: string, toolUsage?: string) => Effect.Effect<boolean>
  readonly updateConfig: (config: Partial<PatternDetectionConfig>) => Effect.Effect<void>
  readonly reset: () => Effect.Effect<void>
}

interface HistoryEntry {
  text: string
  toolUsage: string | undefined
  at: number
}

const defaultConfig: PatternDetectionConfig = {
  enabled: false,
  maxRepetitions: 5,
  timeWindow: 5 * 60 * 1000,
  similarityThreshold: 0.7,
}

function similarity(a: string, b: string): number {
  const la = a.toLowerCase().slice(0, 200)
  const lb = b.toLowerCase().slice(0, 200)
  if (la === lb) return 1
  const longer = la.length > lb.length ? la : lb
  const shorter = la.length > lb.length ? lb : la
  if (longer.length === 0) return 1
  let matches = 0
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i]!)) matches++
  }
  return matches / longer.length
}

const make = Effect.gen(function* () {
  const config = yield* Ref.make<PatternDetectionConfig>(defaultConfig)
  const history = yield* Ref.make<HistoryEntry[]>([])

  const detectPattern = (text: string, toolUsage?: string) =>
    Effect.gen(function* () {
      const cfg = yield* Ref.get(config)
      if (!cfg.enabled) return false

      const now = Date.now()
      const cutoff = now - cfg.timeWindow

      yield* Ref.update(history, (h) => [
        ...h.filter((e) => e.at >= cutoff),
        { text, toolUsage, at: now },
      ])

      const entries = yield* Ref.get(history)
      const recent = entries.filter((e) => e.at >= cutoff)

      const repetitions = recent.filter(
        (e) => e !== recent[recent.length - 1] && similarity(e.text, text) >= cfg.similarityThreshold,
      ).length

      return repetitions >= cfg.maxRepetitions
    })

  const updateConfig = (partial: Partial<PatternDetectionConfig>) =>
    Ref.update(config, (c) => ({ ...c, ...partial }))

  const reset = () => Ref.set(history, [])

  return { detectPattern, updateConfig, reset } satisfies Interface
})

export class Service extends Context.Service<Service, Interface>()("@opencode/PatternDetection") {}

export const layer = Layer.effect(Service, make)
export const defaultLayer = layer

export * as PatternDetection from "./pattern-detection"
