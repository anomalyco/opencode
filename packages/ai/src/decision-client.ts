import { Context, Effect, Layer } from "effect"
import type {
  DecisionAnswer,
  DecisionOptions,
  DecisionQuestion,
  DecisionQuestions,
  DecisionRequestFor,
  DecisionResponseFor,
} from "./decision.js"
import { RequestExecutor } from "./route/executor.js"
import { AIError, InvalidProviderOutputError } from "./schema/index.js"

export type Execute = RequestExecutor.Interface["execute"]

export interface Interface {
  readonly generate: <Options extends DecisionOptions, const Questions extends DecisionQuestions>(
    request: DecisionRequestFor<Options, Questions>,
  ) => Effect.Effect<DecisionResponseFor<Questions>, AIError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AI/DecisionClient") {}

export const generate = <Options extends DecisionOptions, const Questions extends DecisionQuestions>(
  request: DecisionRequestFor<Options, Questions>,
): Effect.Effect<DecisionResponseFor<Questions>, AIError, Service> =>
  Effect.flatMap(Service, (client) => client.generate(request))

export const layer: Layer.Layer<Service, never, RequestExecutor.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    return Service.of({
      generate: Effect.fnUntraced(function* (request) {
        const route = request.model.route
        const response = yield* route.generate(request, executor.execute)
        if (answersMatch(request.questions, response.answers))
          return response as DecisionResponseFor<typeof request.questions>
        return yield* new AIError({
          reason: new InvalidProviderOutputError({
            route: route.id,
            message: "Decision answers do not match the requested questions",
            cause: response.answers,
          }),
        })
      }),
    })
  }),
)
export const fetchLayer = layer.pipe(Layer.provideMerge(RequestExecutor.fetchLayer))

/** Host bugs (a missing or extra answer, an option that wasn't offered, a score off the scale) fail the whole call. */
const answersMatch = (questions: ReadonlyArray<DecisionQuestion>, answers: ReadonlyArray<DecisionAnswer>) =>
  questions.length === answers.length &&
  questions.every((question, index) => {
    const answer = answers[index]
    if (answer.name !== question.name) return false
    if (answer.type === "error") return true
    if (question.type === "predicate") return answer.type === "predicate"
    if (question.type === "choice") {
      if (answer.type !== "choice") return false
      const values = question.choices.map((choice) => choice.value)
      return (
        values.includes(answer.choice) &&
        sameMembers(
          values,
          answer.probabilities.map((item) => item.value),
        )
      )
    }
    if (answer.type !== "score" || answer.score < 0 || answer.score > question.levels.length - 1) return false
    return sameMembers(
      question.levels.map((_, level) => level),
      answer.probabilities.map((item) => item.value),
    )
  })

const sameMembers = <A>(expected: ReadonlyArray<A>, received: ReadonlyArray<A>) =>
  expected.length === received.length &&
  new Set(received).size === received.length &&
  received.every((item) => expected.includes(item))

export const DecisionClient = {
  Service,
  layer,
  fetchLayer,
  generate,
} as const
