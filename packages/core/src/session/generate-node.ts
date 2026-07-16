export * as SessionGenerateNode from "./generate-node"

import { LLM, LLMClient, Message, SystemPart } from "@opencode-ai/ai"
import { Effect, Layer } from "effect"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { llmClient } from "../effect/app-node-platform"
import { PluginHooks } from "../plugin/hooks"
import { SessionContext } from "./context"
import { SessionGenerate } from "./generate"
import { SessionHistory } from "./history"
import { SessionModelHeaders } from "./model-headers"
import { SessionRunnerModel } from "./runner/model"
import PROMPT_DEFAULT from "./runner/prompt/base.txt"
import { toLLMMessages } from "./runner/to-llm-message"

const layer = Layer.effect(
  SessionGenerate.Service,
  Effect.gen(function* () {
    const context = yield* SessionContext.Service
    const database = yield* Database.Service
    const hooks = yield* PluginHooks.Service
    const llm = yield* LLMClient.Service
    const models = yield* SessionRunnerModel.Service

    return SessionGenerate.Service.of({
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
        return (yield* llm.generate(
          LLM.request({
            model: model.model,
            http: { headers: SessionModelHeaders.make(selection.session) },
            providerOptions: { openai: { promptCacheKey } },
            system: contextEvent.system,
            messages: contextEvent.messages,
            tools: [],
            toolChoice: "none",
          }),
        )).text
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: SessionGenerate.Service,
  layer,
  deps: [SessionContext.node, Database.node, PluginHooks.node, SessionRunnerModel.node, llmClient],
})
