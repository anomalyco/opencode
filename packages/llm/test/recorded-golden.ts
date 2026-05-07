import type { HttpRecorder } from "@opencode-ai/http-recorder"
import { describe, type TestOptions } from "bun:test"
import { Effect } from "effect"
import type { ModelRef } from "../src"
import { goldenScenarioTags, runGoldenScenario, type GoldenScenarioID } from "./recorded-scenarios"
import { recordedTests } from "./recorded-test"
import { kebab } from "./recorded-utils"
import { recordedWebSocketTests } from "./recorded-websocket"

type Transport = "http" | "websocket"

type ScenarioInput = GoldenScenarioID | {
  readonly id: GoldenScenarioID
  readonly name?: string
  readonly cassette?: string
  readonly tags?: ReadonlyArray<string>
  readonly maxTokens?: number
  readonly temperature?: number | false
  readonly timeout?: number | TestOptions
}

type TargetInput = {
  readonly name: string
  readonly model: ModelRef
  readonly requires?: ReadonlyArray<string>
  readonly transport?: Transport
  readonly prefix?: string
  readonly tags?: ReadonlyArray<string>
  readonly metadata?: Record<string, unknown>
  readonly options?: HttpRecorder.RecordReplayOptions
  readonly scenarios: ReadonlyArray<ScenarioInput>
}

const scenarioInput = (input: ScenarioInput) => typeof input === "string" ? { id: input } : input

const scenarioTitle = (id: GoldenScenarioID) => {
  if (id === "text") return "streams text"
  if (id === "tool-call") return "streams tool call"
  return "drives a tool loop"
}

const defaultPrefix = (target: TargetInput) => {
  if (target.prefix) return target.prefix
  const transport = target.transport === "websocket" ? "-websocket" : ""
  return `${target.model.provider}-${target.model.protocol}${transport}`
}

const metadata = (target: TargetInput) => ({
  provider: target.model.provider,
  protocol: target.model.protocol,
  adapter: target.model.adapter,
  transport: target.transport ?? "http",
  model: target.model.id,
  ...target.metadata,
})

const tags = (target: TargetInput) => [
  ...(target.transport === "websocket" ? ["transport:websocket"] : []),
  ...(target.tags ?? []),
]

const runTarget = (target: TargetInput) => {
  const recorded = target.transport === "websocket"
    ? recordedWebSocketTests({
      prefix: defaultPrefix(target),
      provider: target.model.provider,
      protocol: target.model.protocol,
      requires: target.requires,
      tags: tags(target),
      metadata: metadata(target),
    })
    : recordedTests({
      prefix: defaultPrefix(target),
      provider: target.model.provider,
      protocol: target.model.protocol,
      requires: target.requires,
      tags: tags(target),
      options: { ...target.options, metadata: { ...target.options?.metadata, ...metadata(target) } },
    })

  describe(`${target.name} recorded`, () => {
    target.scenarios.forEach((raw) => {
      const input = scenarioInput(raw)
      const name = input.name ?? scenarioTitle(input.id)
      recorded.effect.with(
        name,
        {
          cassette: input.cassette,
          id: `${kebab(target.name)}-${input.id}`,
          tags: [...goldenScenarioTags(input.id), ...(input.tags ?? [])],
        },
        () =>
          Effect.gen(function* () {
            yield* runGoldenScenario(input.id, {
              id: `recorded_${kebab(target.name).replaceAll("-", "_")}_${input.id.replaceAll("-", "_")}`,
              model: target.model,
              maxTokens: input.maxTokens,
              temperature: input.temperature,
            })
          }),
        input.timeout,
      )
    })
  })
}

export const describeRecordedGoldenScenarios = (targets: ReadonlyArray<TargetInput>) => {
  targets.forEach(runTarget)
}
