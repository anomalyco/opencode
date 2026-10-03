import type { ConfigModelRace } from "@opencode-ai/core/config/model-race"
import type { ModelReference, RaceOptions } from "./types"

const DEFAULT_OPTIONS: RaceOptions = {
  strategy: {
    firstToken: true,
    throughput: true,
    toolCall: true,
  },
  throughput: {
    warmupTokens: 8,
    measurementWindowMs: 1000,
  },
  switch: {
    enabled: true,
  },
}

export function options(input?: ConfigModelRace.Info): RaceOptions {
  return {
    strategy: {
      firstToken: input?.strategy?.firstToken ?? DEFAULT_OPTIONS.strategy.firstToken,
      throughput: input?.strategy?.throughput ?? DEFAULT_OPTIONS.strategy.throughput,
      toolCall: input?.strategy?.toolCall ?? DEFAULT_OPTIONS.strategy.toolCall,
    },
    throughput: {
      warmupTokens: input?.throughput?.warmupTokens ?? DEFAULT_OPTIONS.throughput.warmupTokens,
      measurementWindowMs: input?.throughput?.measurementWindowMs ?? DEFAULT_OPTIONS.throughput.measurementWindowMs,
    },
    switch: {
      enabled: input?.switch?.enabled ?? DEFAULT_OPTIONS.switch.enabled,
    },
  }
}

export function references(input?: ConfigModelRace.Info): ModelReference[] {
  const models = input?.models ?? []
  return [...new Set(models)].flatMap((id) => {
    const separator = id.indexOf("/")
    if (separator <= 0 || separator === id.length - 1) return []
    return [
      {
        id,
        providerID: id.slice(0, separator),
        modelID: id.slice(separator + 1),
      },
    ]
  })
}
