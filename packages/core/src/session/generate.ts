export * as SessionGenerate from "./generate"

import { LLM, LLMClient, LLMError, Message, SystemPart } from "@opencode-ai/ai"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { llmClient } from "../effect/app-node-platform"
import { makeLocationNode } from "../effect/app-node"
import { Instructions } from "../instructions"
import { PluginHooks } from "../plugin/hooks"
import { AgentNotFoundError } from "./error"
import { SessionContext } from "./context"
import { SessionHistory } from "./history"
import { SessionModelHeaders } from "./model-headers"
import { SessionRunnerModel } from "./runner/model"
import PROMPT_DEFAULT from "./runner/prompt/base.txt"
import { toLLMMessages } from "./runner/to-llm-message"
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
    const database = yield* Database.Service
    const hooks = yield* PluginHooks.Service
    const llm = yield* LLMClient.Service
    const models = yield* SessionRunnerModel.Service

    return Service.of({
      generate: Effect.fn("SessionGenerate.generate")(function* (input) {
        const selection = yield* context.select(input.sessionID)
        const model = yield* models.resolve(selection.session)
        const history = yield* SessionHistory.preview(database.db, selection.session.id, selection.instructions)
        const providerMetadataKey = model.model.route.providerMetadataKey ?? model.model.provider
        const promptCacheKey = /^ses_[0-9a-f]{64}$/.test(selection.session.id)
          ? selection.session.id.slice(4)
          : selection.session.id
        const contextEvent = yield* hooks.trigger("session", "context", {
          sessionID: selection.session.id,
          agent: selection.agent.id,
          model: model.ref,
          system: [selection.agent.info.system ? selection.agent.info.system : PROMPT_DEFAULT, history.initial]
            .filter((part) => part.length > 0)
            .map(SystemPart.make),
          messages: [
            ...toLLMMessages(history.messages, model.ref, providerMetadataKey),
            ...(history.instructionUpdate ? [Message.system(history.instructionUpdate)] : []),
            Message.user(input.prompt),
          ],
          tools: {},
        })
        const request = LLM.request({
          model: model.model,
          http: { headers: SessionModelHeaders.make(selection.session) },
          providerOptions: { openai: { promptCacheKey } },
          system: contextEvent.system,
          messages: contextEvent.messages,
          tools: [],
          toolChoice: "none",
        })
        return (yield* llm.generate(request)).text
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [SessionContext.node, Database.node, PluginHooks.node, SessionRunnerModel.node, llmClient],
})
