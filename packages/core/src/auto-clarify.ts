import { Effect, Layer, Schema, Context, Option } from "effect"
import { QuestionV2 } from "./question"
import { makeLocationNode } from "./effect/app-node"

export class AutoClarifyError extends Schema.TaggedErrorClass<AutoClarifyError>()("AutoClarifyError", {
  message: Schema.String,
}) {}

export interface AutoClarifyDefaults {
  readonly [pattern: string]: ReadonlyArray<string>
}

export interface AutoClarifyConfig {
  readonly mode: "defaults" | "policy" | "fail"
  readonly policyPrompt?: string
  readonly defaults?: AutoClarifyDefaults
}

export interface AutoClarifyInput {
  readonly sessionID: string
  readonly questions: ReadonlyArray<QuestionV2.Info>
  readonly toolContext: {
    readonly messageID: string
    readonly callID: string
    readonly agent: string
  }
  readonly taskContext?: string
}

export interface AutoClarifyResult {
  readonly answers: ReadonlyArray<QuestionV2.Answer>
  readonly source: "default" | "policy" | "fallback"
}

export interface AutoClarify {
  readonly clarify: (input: AutoClarifyInput) => Effect.Effect<AutoClarifyResult, AutoClarifyError>
}

export class AutoClarifyService extends Context.Service<AutoClarifyService, AutoClarify>()("@opencode/AutoClarify") {}

const matchDefault = (
  question: string,
  defaults: AutoClarifyDefaults
): Option.Option<ReadonlyArray<string>> => {
  for (const [pattern, answer] of Object.entries(defaults)) {
    const regex = new RegExp(pattern, "i")
    if (regex.test(question)) return Option.some(answer)
  }
  return Option.none()
}

const layer = Layer.effect(
  AutoClarifyService,
  Effect.gen(function* () {
    const config = yield* Effect.serviceOption(AutoClarifyConfigService)

    const getConfig = Effect.fn("AutoClarify.getConfig")(function () {
      if (Option.isSome(config)) {
        return Effect.succeed(config.value)
      }
      return Effect.succeed({
        mode: "defaults" as const,
        defaults: {
          "confirm.*|proceed.*|continue.*": ["yes"],
          "which file.*|what file.*|file path.*": ["main entry point"],
          "prefer.*|choose.*|select.*": ["simpler option"],
          ".*": ["auto"],
        },
      } satisfies AutoClarifyConfig)
    })

    const clarify = Effect.fn("AutoClarify.clarify")(function (input: AutoClarifyInput) {
      return Effect.gen(function* () {
        const cfg = yield* getConfig()

        if (cfg.mode === "fail") {
          return yield* Effect.fail(new AutoClarifyError({ message: "Auto-clarify disabled; question requires human" }))
        }

        const answers: QuestionV2.Answer[] = []
        let source: AutoClarifyResult["source"] = "fallback"

        for (const question of input.questions) {
          const defaultMatch = matchDefault(question.question, cfg.defaults ?? {})
          if (Option.isSome(defaultMatch)) {
            answers.push(defaultMatch.value)
            source = "default"
            continue
          }

          if (cfg.mode === "policy" && cfg.policyPrompt) {
            answers.push(["auto"])
            source = "policy"
            continue
          }

          answers.push(["auto"])
        }

        return { answers, source }
      })
    })

    return AutoClarifyService.of({ clarify })
  }),
)

export class AutoClarifyConfigService extends Context.Service<AutoClarifyConfigService, AutoClarifyConfig>()("@opencode/AutoClarify/Config") {}

export const defaultConfigLayer = Layer.sync(AutoClarifyConfigService, () =>
  AutoClarifyConfigService.of({
    mode: "defaults",
    defaults: {
      "confirm.*|proceed.*|continue.*": ["yes"],
      "which file.*|what file.*|file path.*": ["main entry point"],
      "prefer.*|choose.*|select.*": ["simpler option"],
      ".*": ["auto"],
    },
  } satisfies AutoClarifyConfig)
)

export const configNode = makeLocationNode({
  name: "auto-clarify/config",
  layer: defaultConfigLayer,
  deps: [],
})

export const AutoClarifyLayer = layer

export const node = makeLocationNode({
  name: "auto-clarify",
  layer,
  deps: [configNode],
})

export * as AutoClarify from "./auto-clarify"