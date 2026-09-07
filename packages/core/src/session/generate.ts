export * as SessionGenerate from "./generate.js"

import { AIError, ContentPolicyError, InvalidProviderOutputError, LLMClient, Message } from "@opencode-ai/ai"
import { Effect } from "effect"
import { Database } from "../database/database.js"
import { Instance } from "../instance/service.js"
import { Plugin } from "../plugin/service.js"
import type { Instructions } from "../instructions/index.js"
import { SessionContext } from "./context.js"
import type { AgentNotFoundError } from "./error.js"
import { SessionHistory } from "./history.js"
import { SessionModelRequest } from "./model-request.js"
import type { SessionRunnerModel } from "./runner/model.js"
import type { SessionSchema } from "./schema.js"

export type Error = AgentNotFoundError | Instructions.InitializationBlocked | SessionRunnerModel.Error | AIError

/** Generates text from current Session context without mutating the Session. */
export const generate = Effect.fn("SessionGenerate.generate")(function* (input: {
  session: SessionSchema.Info
  prompt: string
}) {
  const instances = yield* Instance.Service
  const database = yield* Database.Service
  const llm = yield* LLMClient.Service

  return yield* Effect.gen(function* () {
    yield* Plugin.awaitActivation
    const context = yield* SessionContext.Service
    const selection = yield* context.select(input.session.id)
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
      kind: "generate",
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
    if (response.finishReason.normalized === "content-filter")
      return yield* new AIError({
        reason: new ContentPolicyError({ message: "Provider blocked the response" }),
      })
    if (response.finishReason.normalized === "length" && !response.text && response.toolCalls.length === 0)
      return yield* new AIError({
        reason: new InvalidProviderOutputError({
          message: "The model reached its output limit before producing text or a tool call",
        }),
      })
    return response.text
  }).pipe(instances.provide(input.session))
})
