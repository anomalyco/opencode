import { Context, Effect, Layer } from "effect"
import { RequestExecutor } from "../route/executor.js"
import { AIError, InvalidProviderOutputError, mergeHttpOptions } from "../schema/index.js"
import { sanitizeSurrogates } from "../utils/sanitize.js"
import {
  type EvaluationOptions,
  type EvaluationQuestions,
  type EvaluationRequestFor,
  type EvaluationResponseFor,
} from "./evaluation.js"

export type Execute = RequestExecutor.Interface["execute"]

export interface Interface {
  readonly evaluate: <Options extends EvaluationOptions, const Questions extends EvaluationQuestions>(
    request: EvaluationRequestFor<Options, Questions>,
  ) => Effect.Effect<EvaluationResponseFor<Questions>, AIError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AI/Experimental/EvaluationClient") {}

export const evaluate = <Options extends EvaluationOptions, const Questions extends EvaluationQuestions>(
  request: EvaluationRequestFor<Options, Questions>,
): Effect.Effect<EvaluationResponseFor<Questions>, AIError, Service> =>
  Effect.flatMap(Service, (client) => client.evaluate(request))

export const layer: Layer.Layer<Service, never, RequestExecutor.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    return Service.of({
      evaluate: (request) =>
        request.model.route
          .evaluate(
            {
              ...sanitizeSurrogates({
                ...request,
                model: undefined,
                http: mergeHttpOptions(request.model.http, request.http),
              }),
              model: request.model,
            },
            executor.execute,
          )
          .pipe(
            Effect.flatMap((response) => {
              const questions = Object.entries(request.questions)
              if (
                questions.length === Object.keys(response.answers).length &&
                questions.every(([id, question]) => {
                  const answer = response.answers[id]
                  if (question.type === "boolean") return answer?.type === "boolean"
                  if (question.type === "choice") {
                    if (answer?.type !== "choice" || !Object.hasOwn(question.criteria, answer.choice)) return false
                    if (answer.probabilities === undefined) return true
                    const keys = Object.keys(question.criteria)
                    const probabilities = answer.probabilities
                    return (
                      Object.keys(probabilities).length === keys.length &&
                      keys.every((key) => Object.hasOwn(probabilities, key))
                    )
                  }
                  if (answer?.type !== "score" || answer.score < 0 || answer.score > question.criteria.length - 1)
                    return false
                  if (answer.probabilities === undefined) return true
                  const keys = question.criteria.map((_, index) => String(index))
                  const probabilities = answer.probabilities
                  return (
                    Object.keys(probabilities).length === keys.length &&
                    keys.every((key) => Object.hasOwn(probabilities, key))
                  )
                })
              )
                return Effect.succeed(response as EvaluationResponseFor<typeof request.questions>)
              return Effect.fail(
                new AIError({
                  reason: new InvalidProviderOutputError({
                    route: request.model.route.id,
                    message: "Evaluation answers do not match the requested questions",
                    cause: response.answers,
                  }),
                }),
              )
            }),
          ),
    })
  }),
)
export const fetchLayer = layer.pipe(Layer.provide(RequestExecutor.fetchLayer))

export const EvaluationClient = {
  Service,
  layer,
  fetchLayer,
  evaluate,
} as const
