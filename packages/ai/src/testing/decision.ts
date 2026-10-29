import { Context, Effect, Layer } from "effect"
import { DecisionClient, type Interface } from "../decision-client.js"
import type { DecisionRequestFor, DecisionResponse, DecisionResponseFor } from "../decision.js"
import { AIError } from "../schema/index.js"
import { TestScript } from "./script.js"

/** Returned as scripted, without checking its answers against the request's questions. */
export type Response = DecisionResponse | AIError

export interface TestInterface extends Interface, TestScript.Controls<DecisionRequestFor, Response> {}

export class Test extends Context.Service<Test, TestInterface>()("@opencode/ai/TestDecision/Test") {}

export type LayerOptions = TestScript.Options<DecisionRequestFor, Response>

/** Provides one shared implementation under `DecisionClient.Service` and `TestDecision.Test`. */
export const testLayer = (options: LayerOptions = {}) =>
  Layer.effectContext(
    Effect.sync(() => {
      const script = TestScript.make("TestDecision", options)
      const client = Test.of({
        ...script.controls,
        generate: (request) =>
          script
            .take(request)
            .pipe(
              Effect.flatMap((response) =>
                response instanceof AIError
                  ? Effect.fail(response)
                  : Effect.succeed(response as DecisionResponseFor<typeof request.questions>),
              ),
            ),
      })
      return Context.make(DecisionClient.Service, client).pipe(Context.add(Test, client))
    }),
  )

export * as TestDecision from "./decision.js"
