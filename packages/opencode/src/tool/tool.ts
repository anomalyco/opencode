import z from "zod"
import { Effect } from "effect"
import type { MessageV2 } from "../session/message-v2"
import type { Permission } from "../permission"
import type { SessionID, MessageID } from "../session/schema"
import { Truncate } from "./truncate"
import { Agent } from "@/agent/agent"

export namespace Tool {
  interface Metadata {
    [key: string]: any
  }

  // TODO: remove this hack
  export type DynamicDescription = (agent: Agent.Info) => Effect.Effect<string>

  export type Context<M extends Metadata = Metadata> = {
    sessionID: SessionID
    messageID: MessageID
    agent: string
    abort: AbortSignal
    callID?: string
    extra?: { [key: string]: any }
    messages: MessageV2.WithParts[]
    metadata(input: { title?: string; metadata?: M }): Effect.Effect<void>
    ask(input: Omit<Permission.Request, "id" | "sessionID" | "tool">): Effect.Effect<void>
  }

  export interface ExecuteResult<M extends Metadata = Metadata> {
    title: string
    metadata: M
    output: string
    attachments?: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[]
  }

  export interface Def<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
    id: string
    description: string
    parameters: Parameters
    execute(args: z.infer<Parameters>, ctx: Context): Effect.Effect<ExecuteResult<M>>
    formatValidationError?(error: z.ZodError): string
  }
  export type DefWithoutID<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> = Omit<
    Def<Parameters, M>,
    "id"
  >

  export interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
    id: string
    init: () => Promise<DefWithoutID<Parameters, M>>
  }

  export type InferParameters<T> =
    T extends Info<infer P, any>
      ? z.infer<P>
      : T extends Effect.Effect<Info<infer P, any>, any, any>
        ? z.infer<P>
        : never
  export type InferMetadata<T> =
    T extends Info<any, infer M> ? M : T extends Effect.Effect<Info<any, infer M>, any, any> ? M : never

  export type InferDef<T> =
    T extends Info<infer P, infer M>
      ? Def<P, M>
      : T extends Effect.Effect<Info<infer P, infer M>, any, any>
        ? Def<P, M>
        : never

  function wrap<Parameters extends z.ZodType, Result extends Metadata>(
    id: string,
    init: (() => Promise<DefWithoutID<Parameters, Result>>) | DefWithoutID<Parameters, Result>,
  ) {
    return async () => {
      const toolInfo = init instanceof Function ? await init() : { ...init }
      const execute = toolInfo.execute
      toolInfo.execute = (args, ctx) =>
        Effect.gen(function* () {
          yield* Effect.try({
            try: () => toolInfo.parameters.parse(args),
            catch: (error) => {
              if (error instanceof z.ZodError && toolInfo.formatValidationError) {
                return new Error(toolInfo.formatValidationError(error), { cause: error })
              }
              return new Error(
                `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
                { cause: error },
              )
            },
          })
          const result = yield* execute(args, ctx)
          if (result.metadata.truncated !== undefined) {
            return result
          }
          const agent = yield* Effect.promise(() => Agent.get(ctx.agent))
          const truncated = yield* Effect.promise(() => Truncate.output(result.output, {}, agent))
          return {
            ...result,
            output: truncated.content,
            metadata: {
              ...result.metadata,
              truncated: truncated.truncated,
              ...(truncated.truncated && { outputPath: truncated.outputPath }),
            },
          }
        }).pipe(Effect.orDie)
      return toolInfo
    }
  }

  export function define<Parameters extends z.ZodType, Result extends Metadata, R, ID extends string = string>(
    id: ID,
    init: Effect.Effect<(() => Promise<DefWithoutID<Parameters, Result>>) | DefWithoutID<Parameters, Result>, never, R>,
  ): Effect.Effect<Info<Parameters, Result>, never, R> & { id: ID } {
    return Object.assign(
      Effect.map(init, (next) => ({ id, init: wrap(id, next) })),
      { id },
    )
  }

  export function init<P extends z.ZodType, M extends Metadata>(info: Info<P, M>): Effect.Effect<Def<P, M>> {
    return Effect.gen(function* () {
      const init = yield* Effect.promise(() => info.init())
      return {
        ...init,
        id: info.id,
      }
    })
  }
}
