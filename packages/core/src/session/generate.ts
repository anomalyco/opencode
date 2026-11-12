export * as SessionGenerate from "./generate.js"

import type { FileSystem } from "../filesystem.js"
import { LLMClient, Message, type AIError } from "@opencode/ai/effect"
import type { Model } from "@opencode/schema/model"
import { Effect } from "effect"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { Instance } from "../instance/service.js"
import { Plugin } from "../plugin/service.js"
import type { Instructions } from "../instructions/index.js"
import { SessionContext } from "./context.js"
import { SessionEvent } from "./event.js"
import type { AgentNotFoundError } from "./error.js"
import { SessionHistory } from "./history.js"
import { SessionModelRequest } from "./model-request.js"
import { ModelRetry } from "../model-retry.js"
import type { SessionRunnerModel } from "./runner/model.js"
import type { SessionSchema } from "./schema.js"
import { SessionUsage } from "./usage.js"

export type Error =
  | AgentNotFoundError
  | Instructions.InitializationBlocked
  | SessionRunnerModel.Error
  | AIError
  | FileSystem.DirectoryNotFoundError

export type Result = SessionUsage.Recorded & { readonly text: string }

/**
 * Generates text from current Session context without mutating history.
 * Usage is reported like a step's and added to the Session's totals.
 */
export const generate = Effect.fn("SessionGenerate.generate")(function* (input: {
  session: SessionSchema.Info
  prompt: string
  /** Overrides the Session's model, as compaction does with its agent's model. */
  model?: Model.Ref
  toolChoice?: "none"
  /** `false` sends only the prompt: no system prompt, history or tools. */
  transcript?: boolean
}) {
  const instances = yield* Instance.Service
  const database = yield* Database.Service
  const llm = yield* LLMClient.Service
  const bus = yield* Bus.Service

  return yield* Effect.gen(function* () {
    yield* Plugin.awaitActivation
    const context = yield* SessionContext.Service
    const selection = yield* context.select(input.session.id)
    const model = yield* context.resolveModel(
      input.model ? { ...selection.session, model: input.model } : selection.session,
      { kind: "generate", agent: selection.agent.id },
    )
    const full = input.transcript !== false
    const history = full
      ? yield* SessionHistory.preview(database.db, selection.session.id, selection.instructions, model.ref)
      : undefined
    const transcript = history
      ? SessionModelRequest.baseTranscript({
          agent: selection.agent.info,
          model,
          tools: selection.tools,
          initial: history.initial,
          messages: history.messages,
        })
      : undefined
    const instructionUpdate = history?.instructionUpdate
    const prepared = yield* context.request.generate({
      session: selection.session,
      agent: selection.agent.id,
      model,
      tools: full ? selection.tools : undefined,
      system: transcript ? transcript.system : [],
      messages: transcript
        ? [
            ...transcript.messages,
            ...(instructionUpdate ? [Message.system(instructionUpdate)] : []),
            Message.user(input.prompt),
          ]
        : [Message.user(input.prompt)],
      toolChoice: input.toolChoice,
    })
    yield* Effect.logInfo("sending session generation request", {
      sessionID: selection.session.id,
      providerID: model.ref.providerID,
      modelID: model.ref.id,
    })
    const response = yield* llm.generate(prepared.request, prepared.options).pipe(ModelRetry.retry)
    const usage = SessionUsage.record(response.usage, model.cost)
    yield* bus.publish(SessionEvent.UsageRecorded, { sessionID: selection.session.id, source: "generate", ...usage })
    return { text: response.text, ...usage }
  }).pipe(instances.provide(input.session))
})
