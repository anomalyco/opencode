export * as SessionGenerate from "./generate.js"

import type { FileSystem } from "../filesystem.js"
import { LLMClient, Message, SystemPart, type AIError } from "@opencode/ai/effect"
import { Effect, type JsonSchema } from "effect"
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
import type { Model } from "../model.js"
import { Tool } from "@opencode/schema/tool"
import type { Snapshot } from "../tool.js"
import type { SessionRunnerModel } from "./runner/model.js"
import type { SessionSchema } from "./schema.js"
import { SessionUsage } from "./usage.js"

export type Error =
  | AgentNotFoundError
  | Instructions.InitializationBlocked
  | SessionRunnerModel.Error
  | AIError
  | FileSystem.DirectoryNotFoundError

export type Result = SessionUsage.Recorded & {
  readonly text: string
  /** With `output`, the arguments the model passed to the forced output tool, not yet checked against the schema. */
  readonly output?: unknown
}

/** The forced tool a request with `output` answers through. */
export const OUTPUT_TOOL = "respond"

export interface Input {
  readonly session: SessionSchema.Info
  readonly prompt: string
  /** Without history, the request carries only `system` and `prompt`, not the Session's instructions or messages. */
  readonly history?: boolean
  readonly system?: string
  /** Serve this request with another model than the Session's. */
  readonly model?: Model.Ref
  /** A JSON Schema with an object root. The model must answer by calling {@link OUTPUT_TOOL} with matching arguments. */
  readonly output?: JsonSchema.JsonSchema
}

/**
 * Generates text from current Session context without mutating history.
 * Usage is reported like a step's and added to the Session's totals.
 */
export const generate = Effect.fn("SessionGenerate.generate")(function* (input: Input) {
  const instances = yield* Instance.Service
  const database = yield* Database.Service
  const llm = yield* LLMClient.Service
  const bus = yield* Bus.Service

  return yield* Effect.gen(function* () {
    yield* Plugin.awaitActivation
    const context = yield* SessionContext.Service
    const selection = yield* context.select(input.session.id)
    const model = yield* context.resolveModel(
      input.model === undefined ? selection.session : { ...selection.session, model: input.model },
      { kind: "generate", agent: selection.agent.id },
    )
    const tools =
      input.output === undefined ? (input.history === false ? undefined : selection.tools) : outputTools(input.output)
    const request = yield* input.history === false
      ? Effect.succeed({
          system: input.system === undefined ? [] : [SystemPart.make(input.system)],
          messages: [Message.user(input.prompt)],
        })
      : Effect.gen(function* () {
          const history = yield* SessionHistory.preview(
            database.db,
            selection.session.id,
            selection.instructions,
            model.ref,
          )
          const transcript = SessionModelRequest.baseTranscript({
            agent: selection.agent.info,
            model,
            tools: selection.tools,
            initial: history.initial,
            messages: history.messages,
          })
          return {
            system: [...transcript.system, ...(input.system === undefined ? [] : [SystemPart.make(input.system)])],
            messages: [
              ...transcript.messages,
              ...(history.instructionUpdate ? [Message.system(history.instructionUpdate)] : []),
              Message.user(input.prompt),
            ],
          }
        })
    const prepared = yield* context.request.generate({
      session: selection.session,
      agent: selection.agent.id,
      model,
      tools,
      system: request.system,
      messages: request.messages,
      ...(input.output === undefined ? {} : { toolChoice: OUTPUT_TOOL }),
    })
    yield* Effect.logInfo("sending session generation request", {
      sessionID: selection.session.id,
      providerID: model.ref.providerID,
      modelID: model.ref.id,
    })
    const response = yield* llm.generate(prepared.request, prepared.options).pipe(ModelRetry.retry)
    const usage = SessionUsage.record(response.usage, model.cost)
    yield* bus.publish(SessionEvent.UsageRecorded, { sessionID: selection.session.id, source: "generate", ...usage })
    const call = input.output === undefined ? undefined : response.toolCalls.find((item) => item.name === OUTPUT_TOOL)
    return { text: response.text, ...(call === undefined ? {} : { output: call.input }), ...usage }
  }).pipe(instances.provide(input.session))
})

// Only the output tool, so the model has nothing else to call; the forced choice makes it answer through it.
const outputTools = (schema: JsonSchema.JsonSchema): Snapshot => ({
  definitions: [
    { type: "tool", name: OUTPUT_TOOL, description: "Return your answer by calling this tool.", inputSchema: schema },
  ],
  execute: () => new Tool.Error({ message: `${OUTPUT_TOOL} only carries the answer; it does not run.` }),
})
