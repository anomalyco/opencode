export * as SubagentTool from "./subagent"

import { ToolFailure, LLMClient, LLM } from "@opencode-ai/llm"
import { Effect, Layer, Schema, DateTime } from "effect"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { EventV2 } from "../event"
import { SessionEvent } from "../session/event"
import { SessionStore } from "../session/store"
import { SessionRunnerModel } from "../session/runner/model"

export const name = "zero_research_agent"

export const Input = Schema.Struct({
  prompt: Schema.String.annotate({ description: "The research query or task for the subagent to solve" }),
})

export const Output = Schema.Struct({
  result: Schema.String,
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const events = yield* EventV2.Service
    const store = yield* SessionStore.Service
    const models = yield* SessionRunnerModel.Service
    const permission = yield* PermissionV2.Service
    const llm = yield* LLMClient.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description: "Spawn an autonomous research subagent to perform analysis or answer complex queries in detail.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.result }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              const publishProgress = (text: string) =>
                Effect.gen(function* () {
                  const now = yield* DateTime.now
                  yield* events.publish(SessionEvent.Tool.Progress, {
                    timestamp: now,
                    sessionID: context.sessionID,
                    assistantMessageID: context.assistantMessageID,
                    callID: context.toolCallID,
                    structured: {},
                    content: [{ type: "text", text }],
                  })
                })

              // Step 1: Initializing
              yield* publishProgress(`🔍 [Subagente] Iniciando pesquisa para: "${input.prompt}"...`)
              yield* Effect.sleep("1 seconds")

              // Fetch session and resolve model
              const session = yield* store.get(context.sessionID)
              if (!session) return yield* new ToolFailure({ message: "Session not found" })
              const model = yield* models.resolve(session)

              // Step 2: Querying model
              yield* publishProgress(`🧠 [Subagente] Enviando consulta ao modelo de linguagem (${model.id})...`)

              const request = LLM.request({
                model,
                system: "Você é um subagente de pesquisa autônomo de elite do ZERO. Analise o prompt do usuário e forneça uma resposta extremamente detalhada, bem estruturada, contendo fatos, análises lógicas e conclusões claras em português.",
                prompt: input.prompt,
              })

              const response = yield* llm.generate(request).pipe(
                Effect.mapError((err) => new ToolFailure({ message: `Subagent LLM call failed: ${err.reason.message}` }))
              )

              // Step 3: Compiling results
              yield* publishProgress(`📝 [Subagente] Compilando e sintetizando resultados da pesquisa...`)
              yield* Effect.sleep("1 seconds")

              // Extract text from response events
              const textParts: string[] = []
              for (const event of response.events) {
                if (event.type === "text-delta") {
                  textParts.push(event.text)
                }
              }
              const result = textParts.join("") || "Nenhum resultado gerado pelo subagente."

              yield* publishProgress(`✅ [Subagente] Pesquisa concluída com sucesso!`)

              return { result }
            }).pipe(
              Effect.mapError((err) => (err instanceof ToolFailure ? err : new ToolFailure({ message: "Subagent failed" })))
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
