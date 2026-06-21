export * as SwarmTool from "./swarm"

import { ToolFailure, LLMClient, LLM } from "@opencode-ai/llm"
import { Effect, Layer, Schema, DateTime } from "effect"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { EventV2 } from "../event"
import { SessionEvent } from "../session/event"
import { SessionStore } from "../session/store"
import { SessionRunnerModel } from "../session/runner/model"

export const name = "zero_swarm_agents"

export const Input = Schema.Struct({
  task: Schema.String.annotate({ description: "The coding or analytical task to perform cooperatively" }),
  rounds: Schema.Number.pipe(Schema.optional).annotate({ description: "Number of cooperation rounds (default: 2)" }),
})

export const Output = Schema.Struct({
  result: Schema.String,
  history: Schema.Array(
    Schema.Struct({
      agent: Schema.String,
      round: Schema.Number,
      content: Schema.String,
    })
  ),
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const events = yield* EventV2.Service
    const store = yield* SessionStore.Service
    const models = yield* SessionRunnerModel.Service
    const permission = yield* PermissionV2.Service
    const llm = yield* LLMClient.Service

    yield* tools.register({
      [name]: Tool.make({
        description: "Spawn a cooperative swarm of specialized agents (Programmer & Reviewer) to design and critique solutions.",
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

            const numRounds = input.rounds ?? 2
            yield* publishProgress(`🚀 [Swarm] Iniciando swarm de agentes para a tarefa. Rodadas planejadas: ${numRounds}`)

            const session = yield* store.get(context.sessionID)
            if (!session) return yield* Effect.fail(new ToolFailure({ message: "Session not found" }))
            const model = yield* models.resolve(session)

            const history: Array<{ agent: string; round: number; content: string }> = []
            let lastReviewerFeedback = "Nenhum feedback anterior disponível."

            for (let r = 1; r <= numRounds; r++) {
              // --- PROGRAMMER STEP ---
              yield* publishProgress(`💻 [Swarm] Rodada ${r}/${numRounds}: Programador elaborando/refinando a solução...`)

              const programmerPrompt = `Você é o Programador do Swarm. Sua tarefa é propor uma solução detalhada ou implementação de código para a tarefa: '${input.task}'. Levando em consideração o feedback anterior do Revisor (se houver):\n${lastReviewerFeedback}\n\nForneça sua resposta estruturada e clara em português.`

              const programmerRequest = LLM.request({
                model,
                system: "Você é o Programador do Swarm, focado em produzir código de alta qualidade, correto e otimizado.",
                prompt: programmerPrompt,
              })

              const programmerResponse = yield* llm.generate(programmerRequest).pipe(
                Effect.mapError((err) => new ToolFailure({ message: `Programmer LLM call failed: ${err.reason.message}` }))
              )

              const programmerTextParts: string[] = []
              for (const event of programmerResponse.events) {
                if (event.type === "text-delta") {
                  programmerTextParts.push(event.text)
                }
              }
              const programmerSolution = programmerTextParts.join("") || "Falha ao obter solução do Programador."

              history.push({
                agent: "Programador",
                round: r,
                content: programmerSolution,
              })

              // --- REVIEWER STEP ---
              yield* publishProgress(`🔍 [Swarm] Rodada ${r}/${numRounds}: Revisor analisando criticamente a solução do Programador...`)

              const reviewerPrompt = `Você é o Revisor do Swarm. Analise criticamente a solução proposta pelo Programador:\n${programmerSolution}\n\nIdentifique possíveis bugs, problemas de segurança, melhorias arquiteturais ou erros de lógica. Forneça um feedback construtivo e direto em português para que o Programador possa corrigir na próxima rodada.`

              const reviewerRequest = LLM.request({
                model,
                system: "Você é o Revisor do Swarm, focado em revisar soluções de código, identificar bugs e propor melhorias arquiteturais.",
                prompt: reviewerPrompt,
              })

              const reviewerResponse = yield* llm.generate(reviewerRequest).pipe(
                Effect.mapError((err) => new ToolFailure({ message: `Reviewer LLM call failed: ${err.reason.message}` }))
              )

              const reviewerTextParts: string[] = []
              for (const event of reviewerResponse.events) {
                if (event.type === "text-delta") {
                  reviewerTextParts.push(event.text)
                }
              }
              const reviewerFeedback = reviewerTextParts.join("") || "Falha ao obter feedback do Revisor."

              history.push({
                agent: "Revisor",
                round: r,
                content: reviewerFeedback,
              })

              lastReviewerFeedback = reviewerFeedback
            }

            yield* publishProgress(`✅ [Swarm] Swarm cooperativo finalizado com sucesso!`)

            // Return the final Programmer solution (from the last round) as result, plus full history
            const finalResult = history.filter((h) => h.agent === "Programador").pop()?.content || ""

            return {
              result: finalResult,
              history,
            }
          }).pipe(
            Effect.mapError((err) => (err instanceof ToolFailure ? err : new ToolFailure({ message: "Swarm execution failed" })))
          ),
      }),
    }).pipe(Effect.orDie)
  }),
)
