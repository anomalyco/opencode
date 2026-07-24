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
  readonly model?: string
  readonly prompt: string
  readonly result: Result
}

export interface Interface {
  readonly childID: (parentID: SessionSchema.ID, id: string) => SessionSchema.ID
  readonly runChild: <Result extends Tool.SchemaType<any>>(
    input: ChildInput<Result>,
  ) => Effect.Effect<Schema.Schema.Type<Result>, Tool.Failure>
  readonly progress: (context: Tool.Context, structured: Record<string, unknown>, text: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WorkflowRuntime") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const sessions = yield* SessionV2.Service
    const sessionTools = yield* SessionTools.Service
    const childID = (parentID: SessionSchema.ID, id: string) =>
      SessionSchema.ID.make(`ses_workflow_${Hash.fast(`${parentID}:${id}`)}`)

    return Service.of({
      childID,
      runChild: Effect.fn("WorkflowRuntime.runChild")(function* <Result extends Tool.SchemaType<any>>(
        input: ChildInput<Result>,
      ) {
        return yield* Effect.gen(function* () {
          const id = childID(input.parentID, input.id)
          const model = input.model ? ModelV2.parse(input.model) : undefined
          yield* sessions.create({
            id,
            parentID: input.parentID,
            location: input.location,
            title: input.title,
            agent: input.agent,
            model: model ? { id: model.modelID, providerID: model.providerID } : undefined,
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
          if (previous) return previous.value

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
              yield* sessions.prompt({
                id: SessionMessage.ID.make(`msg_workflow_${Hash.fast(`${input.parentID}:${input.id}`)}`),
                sessionID: id,
                prompt: { text: input.prompt },
                resume: false,
              })
              yield* sessions.resume(id).pipe(Effect.onInterrupt(() => sessions.interrupt(id)))
              if (yield* Deferred.isDone(completed)) return yield* Deferred.await(completed)
              return yield* new Tool.Failure({
                message: `Workflow child ${id} ended without submitting workflow_result`,
              })
            }),
          )
        }).pipe(
          Effect.mapError((error) =>
            error instanceof Tool.Failure ? error : new Tool.Failure({ message: String(error) }),
          ),
        )
      }),
      progress: Effect.fn("WorkflowRuntime.progress")(function* (context, structured, text) {
        yield* events.publish(SessionEvent.Tool.Progress, {
          sessionID: context.sessionID,
          timestamp: yield* DateTime.now,
          assistantMessageID: context.assistantMessageID,
          callID: context.toolCallID,
          structured,
          content: [{ type: "text", text }],
        })
      }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [EventV2.node, SessionV2.node, SessionTools.node],
})
