export * as SessionGenerate from "./generate"

import { LLMClient, LLMError } from "@opencode-ai/ai"
import { Context, Effect, Layer } from "effect"
import { llmClient } from "../effect/app-node-platform"
import { makeLocationNode } from "../effect/app-node"
import { Instructions } from "../instructions"
import { AgentNotFoundError } from "./error"
import { SessionContext } from "./context"
import { SessionModelRequest } from "./model-request"
import { SessionRunnerModel } from "./runner/model"
import { SessionSchema } from "./schema"

export type Error = AgentNotFoundError | Instructions.InitializationBlocked | SessionRunnerModel.Error | LLMError

export interface Interface {
  /** Generates text from current Session context without mutating the Session. */
  readonly generate: (input: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: string
  }) => Effect.Effect<string, Error>
}

/** Location-scoped transient generation from Session context. */
export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionGenerate") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const context = yield* SessionContext.Service
    const requests = yield* SessionModelRequest.Service
    const llm = yield* LLMClient.Service

    return Service.of({
      generate: Effect.fn("SessionGenerate.generate")(function* (input) {
        const selection = yield* context.select(input.sessionID)
        const loaded = yield* context.loadForGenerate(selection)
        const request = yield* requests.prepareGenerate({ context: loaded, prompt: input.prompt })
        return (yield* llm.generate(request)).text
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [SessionContext.node, SessionModelRequest.node, llmClient],
})
