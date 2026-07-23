export * as SessionGenerateNode from "./generate-node"

import { LLM, LLMClient, Message, SystemPart } from "@opencode-ai/ai"
import { Effect, Layer } from "effect"
import { Database } from "../database/database"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { App } from "../app"
import { llmClient } from "../effect/app-node-platform"
import { PluginHooks } from "../plugin/hooks"
import { SessionContext } from "./context"
import { SessionGenerate } from "./generate"
import { SessionHistory } from "./history"
import { SessionModelHeaders } from "./model-headers"
import { SessionRunnerModel } from "./runner/model"
import { ToolRegistry } from "../tool/registry"
import PROMPT_DEFAULT from "./runner/prompt/base.txt"
import { toLLMMessages } from "./runner/to-llm-message"

export const layer = Layer.effect(
  SessionGenerate.Service,
  Effect.gen(function* () {
    const context = yield* SessionContext.Service
    const database = yield* Database.Service
    const hooks = yield* PluginHooks.Service
    const llm = yield* LLMClient.Service
    const models = yield* SessionRunnerModel.Service
    const registry = yield* ToolRegistry.Service
    const app = yield* App.Metadata

    return SessionGenerate.Service.of({
      generate: Effect.fn("SessionGenerate.generate")(function* (input) {
        const selection = yield* context.select(input.sessionID)
        const model = yield* models.resolve(selection.session)
        const history = yield* SessionHistory.preview(database.db, selection.session.id, selection.instructions)
        const providerMetadataKey = model.model.route.providerMetadataKey ?? model.model.provider
        const promptCacheKey = /^ses_[0-9a-f]{64}$/.test(selection.session.id)
          ? selection.session.id.slice(4)
          : selection.session.id
        const executableTools = yield* registry.materialize(selection.agent.info.permissions)
        const toolDefinitions = executableTools.definitions
        const toolsByName = new Map(toolDefinitions.map((tool) => [tool.name, tool]))
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
          tools: Object.fromEntries(
            toolDefinitions.map((tool) => [tool.name, { description: tool.description, input: { ...tool.inputSchema } }]),
          ),
        })
        const hookedTools = Object.entries(contextEvent.tools).flatMap(([name, tool]) => {
          const registered = toolsByName.get(name)
          return registered
            ? [Object.assign({}, registered, { description: tool.description, inputSchema: tool.input })]
            : []
        })
        yield* Effect.logInfo("sending session generation request", {
          sessionID: selection.session.id,
          providerID: model.ref.providerID,
          modelID: model.ref.id,
        })
        const response = yield* llm.generate(
          LLM.request({
            model: model.model,
            http: { headers: SessionModelHeaders.make(selection.session, app) },
            providerOptions: { openai: { promptCacheKey } },
            system: contextEvent.system,
            messages: contextEvent.messages,
            tools: hookedTools,
          }),
        )
        yield* Effect.logInfo("session generation usage diagnostic", { usage: response.usage })
        return response.text
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: SessionGenerate.Service,
  layer,
  deps: [
    SessionContext.node,
    Database.node,
    PluginHooks.node,
    SessionRunnerModel.node,
    ToolRegistry.node,
    App.node,
    llmClient,
  ],
})
