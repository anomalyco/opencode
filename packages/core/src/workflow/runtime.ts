export * as WorkflowRuntime from "./runtime"

import { Context, DateTime, Deferred, Effect, Layer, Option, Schema } from "effect"
import { AgentV2 } from "../agent"
import { makeGlobalNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { Location } from "../location"
import { ModelV2 } from "../model"
import { SessionV2 } from "../session"
import { SessionEvent } from "../session/event"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { SessionTools } from "../tool/session-tools"
import { Tool } from "../tool/tool"
import { Hash } from "../util/hash"

export interface ChildInput<Result extends Tool.SchemaType<any>> {
  readonly id: string
  readonly parentID: SessionSchema.ID
  readonly location: Location.Ref
  readonly title: string
  readonly agent: AgentV2.ID
  readonly model?: ModelV2.Ref
  readonly timeoutMs: number
  readonly prompt: string
  readonly result: Result
  readonly progress?: {
    readonly context: RunContext
    readonly workflow: "heavy" | "council"
    readonly phase: string
    readonly stage: string
  }
}

export interface Progress {
  readonly structured: Record<string, unknown>
  readonly text: string
}

export interface RunContext extends Tool.Context {
  readonly onProgress?: (input: Progress) => Effect.Effect<void>
}

export interface Interface {
  readonly childID: (parentID: SessionSchema.ID, id: string) => SessionSchema.ID
  readonly runChild: <Result extends Tool.SchemaType<any>>(
    input: ChildInput<Result>,
  ) => Effect.Effect<Schema.Schema.Type<Result>, Tool.Failure>
  readonly progress: (context: RunContext, structured: Record<string, unknown>, text: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WorkflowRuntime") {}

export function resolveModel(parent: ModelV2.Ref | undefined, override: string | undefined): ModelV2.Ref | undefined {
  if (!override) return parent
  const parsed = ModelV2.parse(override)
  return { id: parsed.modelID, providerID: parsed.providerID }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const sessions = yield* SessionV2.Service
    const sessionTools = yield* SessionTools.Service
    const childID = (parentID: SessionSchema.ID, id: string) =>
      SessionSchema.ID.make(`ses_workflow_${Hash.fast(`${parentID}:${id}`)}`)
    const progress = Effect.fn("WorkflowRuntime.progress")(function* (
      context: RunContext,
      structured: Record<string, unknown>,
      text: string,
    ) {
      yield* events.publish(SessionEvent.Tool.Progress, {
        sessionID: context.sessionID,
        timestamp: yield* DateTime.now,
        assistantMessageID: context.assistantMessageID,
        callID: context.toolCallID,
        structured,
        content: [{ type: "text", text }],
      })
      if (context.onProgress) yield* context.onProgress({ structured, text })
    })

    return Service.of({
      childID,
      runChild: Effect.fn("WorkflowRuntime.runChild")(function* <Result extends Tool.SchemaType<any>>(
        input: ChildInput<Result>,
      ) {
        return yield* Effect.gen(function* () {
          const id = childID(input.parentID, input.id)
          yield* sessions.create({
            id,
            parentID: input.parentID,
            location: input.location,
            title: input.title,
            agent: input.agent,
            model: input.model,
          })
          const startedAt = DateTime.toEpochMillis(yield* DateTime.now)
          const report = Effect.fnUntraced(function* (
            status: "running" | "completed" | "failed" | "timed_out",
            text: string,
            error?: string,
          ) {
            if (!input.progress) return
            const updatedAt = DateTime.toEpochMillis(yield* DateTime.now)
            yield* progress(
              input.progress.context,
              {
                workflow: input.progress.workflow,
                phase: input.progress.phase,
                stage: input.progress.stage,
                child_status: status,
                session_id: id,
                child_agent: input.agent,
                child_title: input.title,
                started_at: startedAt,
                updated_at: updatedAt,
                elapsed_ms: Math.max(0, updatedAt - startedAt),
                ...(error === undefined ? {} : { error }),
              },
              text,
            )
          })
          const decode = Schema.decodeUnknownOption(input.result)
          const previous = (yield* sessions.messages({ sessionID: id, order: "desc" }))
            .flatMap((message) => (message.type === "assistant" ? message.content : []))
            .flatMap((part) =>
              part.type === "tool" && part.name === "workflow_result" && part.state.status === "completed"
                ? [part.state.structured]
                : [],
            )
            .map((structured) => decode(structured))
            .find(Option.isSome)
          if (previous) {
            yield* report("completed", `${input.title} was already completed`)
            return previous.value
          }

          return yield* Effect.scoped(
            Effect.gen(function* () {
              const completed = yield* Deferred.make<Schema.Schema.Type<Result>>()
              yield* sessionTools.register(id, {
                workflow_result: Tool.asTerminal(
                  Tool.make({
                    description:
                      "Submit the complete structured result for this workflow stage. Call this exactly once when done.",
                    input: input.result,
                    output: input.result,
                    execute: (result) => Deferred.succeed(completed, result).pipe(Effect.as(result)),
                  }),
                ),
              })
              yield* report("running", `${input.title} is running`)
              yield* sessions.prompt({
                id: SessionMessage.ID.make(`msg_workflow_${Hash.fast(`${input.parentID}:${input.id}`)}`),
                sessionID: id,
                prompt: { text: input.prompt },
                resume: false,
              })
              const resumed = yield* sessions.resume(id).pipe(
                Effect.onInterrupt(() => sessions.interrupt(id)),
                Effect.tapError((error) =>
                  report(
                    "failed",
                    `${input.title} failed: ${error instanceof Error ? error.message : String(error)}`,
                    error instanceof Error ? error.message : String(error),
                  ),
                ),
                Effect.timeoutOption(input.timeoutMs),
              )
              if (Option.isNone(resumed)) {
                const message = `${input.title} timed out after ${input.timeoutMs} ms`
                yield* report("timed_out", message, message)
                return yield* new Tool.Failure({ message })
              }
              if (yield* Deferred.isDone(completed)) {
                const result = yield* Deferred.await(completed)
                yield* report("completed", `${input.title} completed`)
                return result
              }
              const message = `Workflow child ${id} ended without submitting workflow_result`
              yield* report("failed", `${input.title} failed: ${message}`, message)
              return yield* new Tool.Failure({ message })
            }),
          ).pipe(
            Effect.onInterrupt(() => {
              const message = `${input.title} was interrupted`
              return report("failed", message, message)
            }),
          )
        }).pipe(
          Effect.mapError((error) =>
            error instanceof Tool.Failure ? error : new Tool.Failure({ message: String(error) }),
          ),
        )
      }),
      progress,
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [EventV2.node, SessionV2.node, SessionTools.node],
})
