export * as SessionGenerate from "./generate.js"

import type { FileSystem } from "../filesystem.js"
import {
  AIError,
  InvalidProviderOutputError,
  type JsonSchema,
  LLMClient,
  LLMRequest,
  Message,
  ToolChoice,
  ToolDefinition,
} from "@opencode/ai"
import { Effect, Schema } from "effect"
import { Database } from "../database/database.js"
import { Instance } from "../instance/service.js"
import { Plugin } from "../plugin/service.js"
import type { Instructions } from "../instructions/index.js"
import { SessionContext } from "./context.js"
import type { AgentNotFoundError } from "./error.js"
import { SessionHistory } from "./history.js"
import { SessionProviderContext } from "./provider-context.js"
import { SessionModelRequest } from "./model-request.js"
import type { SessionRunnerModel } from "./runner/model.js"
import type { SessionSchema } from "./schema.js"

export type Error =
  | AgentNotFoundError
  | Instructions.InitializationBlocked
  | SessionRunnerModel.Error
  | AIError
  | FileSystem.DirectoryNotFoundError

const STRUCTURED_OUTPUT_TOOL = "structured_output"

export interface Result {
  readonly text: string
  /** The forced tool call's input when a `schema` was requested. It is not validated against that schema. */
  readonly object?: Schema.Json
}

/**
 * Generates from current Session context without mutating the Session. With a `schema`, the model is forced to call a
 * synthetic tool whose input is that JSON Schema, and the call's input is returned as `object`.
 */
export const generate = Effect.fn("SessionGenerate.generate")(function* (input: {
  session: SessionSchema.Info
  prompt: string
  schema?: JsonSchema
}) {
  const instances = yield* Instance.Service
  const database = yield* Database.Service
  const llm = yield* LLMClient.Service

  return yield* Effect.gen(function* () {
    yield* Plugin.awaitActivation
    const context = yield* SessionContext.Service
    const selection = yield* context.select(input.session.id)
    const model = yield* context.resolveModel(selection.session)
    const history = yield* SessionHistory.preview(
      database.db,
      selection.session.id,
      selection.instructions,
      SessionProviderContext.provenance(model) ?? "local",
    )
    const transcript = SessionModelRequest.baseTranscript({
      agent: selection.agent.info,
      model,
      tools: selection.tools,
      initial: history.initial,
      messages: history.messages,
    })
    const prepared = yield* context.request.generate({
      session: selection.session,
      agent: selection.agent.id,
      model,
      tools: selection.tools,
      system: transcript.system,
      messages: [
        ...transcript.messages,
        ...(history.instructionUpdate ? [Message.system(history.instructionUpdate)] : []),
        Message.user(input.prompt),
      ],
    })
    yield* Effect.logInfo("sending session generation request", {
      sessionID: selection.session.id,
      providerID: model.ref.providerID,
      modelID: model.ref.id,
    })
    // Session tools stay advertised because some providers reject tool history without tool definitions.
    const request = input.schema
      ? LLMRequest.update(prepared.request, {
          tools: [
            ...prepared.request.tools,
            ToolDefinition.make({
              name: STRUCTURED_OUTPUT_TOOL,
              description: "Return the structured result by calling this tool.",
              inputSchema: input.schema,
            }),
          ],
          toolChoice: ToolChoice.named(STRUCTURED_OUTPUT_TOOL),
        })
      : prepared.request
    const response = yield* llm.generate(request, prepared.options)
    yield* Effect.logInfo("session generation usage diagnostic", { usage: response.usage })
    if (!input.schema) return { text: response.text }
    const call = response.toolCalls.find((event) => event.name === STRUCTURED_OUTPUT_TOOL)
    if (!call)
      return yield* new AIError({
        reason: new InvalidProviderOutputError({
          message: `Model did not call the forced \`${STRUCTURED_OUTPUT_TOOL}\` tool`,
        }),
      })
    // Protocols parse tool call arguments with JSON.parse, so the input is already JSON.
    return { text: response.text, object: call.input as Schema.Json }
  }).pipe(instances.provide(input.session))
})
