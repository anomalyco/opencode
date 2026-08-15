export * as SessionGenerateNode from "./generate-node.js"

import { LLMClient, Message, SystemPart } from "@opencode-ai/ai"
import { Effect, Layer } from "effect"
import { Database } from "../database/database.js"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { llmClient } from "../effect/app-node-platform.js"
import { SessionContext } from "./context.js"
import { SessionGenerate } from "./generate.js"
import { SessionHistory } from "./history.js"
import { SessionModelRequest } from "./model-request.js"
import { SessionRunnerModel } from "./runner/model.js"
import { SessionSystemPrompt } from "./system-prompt.js"
import { toLLMMessages } from "./runner/to-llm-message.js"

export const layer = Layer.effect(
  SessionGenerate.Service,
  Effect.gen(function* () {
    const context = yield* SessionContext.Service
    const database = yield* Database.Service
    const llm = yield* LLMClient.Service
    const models = yield* SessionRunnerModel.Service
    const modelRequests = yield* SessionModelRequest.Service

    return SessionGenerate.Service.of({
      generate: Effect.fn("SessionGenerate.generate")(function* (input) {
        const selection = yield* context.select(input.sessionID)
        const model = yield* models.resolve(selection.session)
        const history = yield* SessionHistory.preview(database.db, selection.session.id, selection.instructions)
        const providerMetadataKey = model.model.route.providerMetadataKey ?? model.model.provider
        const prepared = yield* modelRequests.prepare({
          scope: { session: selection.session, agentID: selection.agent.id, model, tools: selection.tools },
          transcript: {
            system: [
              selection.agent.info.system
                ? selection.agent.info.system
                : SessionSystemPrompt.make(selection.tools.definitions.map((tool) => tool.name)),
              history.initial,
            ]
              .filter((part) => part.length > 0)
              .map(SystemPart.make),
            messages: [
              ...toLLMMessages(history.messages, model.ref, providerMetadataKey),
              ...(history.instructionUpdate ? [Message.system(history.instructionUpdate)] : []),
              Message.user(input.prompt),
            ],
          },
          webSocket: false,
        })
        yield* Effect.logInfo("sending session generation request", {
          sessionID: selection.session.id,
          providerID: model.ref.providerID,
          modelID: model.ref.id,
        })
        const response = yield* llm.generate(prepared.request, prepared.options)
        yield* Effect.logInfo("session generation usage diagnostic", { usage: response.usage })
        return response.text
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: SessionGenerate.Service,
  layer,
  deps: [SessionContext.node, Database.node, SessionModelRequest.node, SessionRunnerModel.node, llmClient],
})
