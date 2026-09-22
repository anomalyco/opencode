import { Context, Effect, Layer } from "effect"
import { RequestExecutor } from "../route/executor.js"
import { mergeHttpOptions, type AIError } from "../schema/index.js"
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
        request.model.route.evaluate(
          {
            ...sanitizeSurrogates({
              ...request,
              model: undefined,
              http: mergeHttpOptions(request.model.http, request.http),
            }),
            model: request.model,
          },
          executor.execute,
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
