export * as SessionGenerateNode from "./generate-node.js"

import { LLMClient, Message } from "@opencode-ai/ai"
import { Effect, Layer } from "effect"
import { Database } from "../database/database.js"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { llmClient } from "../effect/app-node-platform.js"
import { SessionContext } from "./context.js"
import { SessionGenerate } from "./generate.js"
import { SessionHistory } from "./history.js"
import { SessionModelRequest } from "./model-request.js"

export const layer = Layer.effect(
  SessionGenerate.Service,
  Effect.gen(function* () {
    const context = yield* SessionContext.Service
    const database = yield* Database.Service
    const llm = yield* LLMClient.Service

    return SessionGenerate.Service.of({
      generate: Effect.fn("SessionGenerate.generate")(function* (input) {
        const selection = yield* context.select(input.sessionID)
        const model = yield* context.resolveModel(selection.session)
        const history = yield* SessionHistory.preview(database.db, selection.session.id, selection.instructions)
        const transcript = SessionModelRequest.baseTranscript({
          agent: selection.agent.info,
          model,
          tools: selection.tools,
          initial: history.initial,
          messages: history.messages,
        })
        const prepared = yield* context.prepare({
          scope: { session: selection.session, agentID: selection.agent.id, model, tools: selection.tools },
          transcript: {
            system: transcript.system,
            messages: [
              ...transcript.messages,
              ...(history.instructionUpdate ? [Message.system(history.instructionUpdate)] : []),
              Message.user(input.prompt),
            ],
          },
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
  deps: [SessionContext.node, Database.node, llmClient],
})
