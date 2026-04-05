import z from "zod"
import { Effect } from "effect"
import type { MessageV2 } from "../session/message-v2"
import type { Agent } from "../agent/agent"
import type { Permission } from "../permission"
import type { SessionID, MessageID } from "../session/schema"
import { Truncate } from "./truncate"

export namespace Tool {
  interface Metadata {
    [key: string]: any
  }

  export interface InitContext {
    agent?: Agent.Info
  }

  export type Context<M extends Metadata = Metadata> = {
    sessionID: SessionID
    messageID: MessageID
    agent: string
    abort: AbortSignal
    callID?: string
    extra?: { [key: string]: any }
    messages: MessageV2.WithParts[]
    metadata(input: { title?: string; metadata?: M }): void
    ask(input: Omit<Permission.Request, "id" | "sessionID" | "tool">): Promise<void>
  }
  export interface Def<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
    description: string
    parameters: Parameters
    execute(
      args: z.infer<Parameters>,
      ctx: Context,
    ): Promise<{
      title: string
      metadata: M
      output: string
      attachments?: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[]
    }>
    formatValidationError?(error: z.ZodError): string
  }

  export interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
    id: string
    init: (ctx?: InitContext) => Promise<Def<Parameters, M>>
  }

  export type InferParameters<T> =
    T extends Info<infer P, any>
      ? z.infer<P>
      : T extends Effect.Effect<Info<infer P, any>, any, any>
        ? z.infer<P>
        : never
  export type InferMetadata<T> =
    T extends Info<any, infer M> ? M : T extends Effect.Effect<Info<any, infer M>, any, any> ? M : never

  function wrap<Parameters extends z.ZodType, Result extends Metadata>(
    id: string,
    init: ((ctx?: InitContext) => Promise<Def<Parameters, Result>>) | Def<Parameters, Result>,
  ) {
    return async (initCtx?: InitContext) => {
      const toolInfo = init instanceof Function ? await init(initCtx) : { ...init }
      const execute = toolInfo.execute
      toolInfo.execute = async (args, ctx) => {
        try {
          toolInfo.parameters.parse(args)
        } catch (error) {
          if (error instanceof z.ZodError && toolInfo.formatValidationError) {
            throw new Error(toolInfo.formatValidationError(error), { cause: error })
          }
          throw new Error(
            `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
            { cause: error },
          )
        }
        const result = await execute(args, ctx)
        if (result.metadata.truncated !== undefined) {
          return result
        }
        const truncated = await Truncate.output(result.output, {}, initCtx?.agent)
        return {
          ...result,
          output: truncated.content,
          metadata: {
            ...result.metadata,
            truncated: truncated.truncated,
            ...(truncated.truncated && { outputPath: truncated.outputPath }),
          },
        }
      }
      return toolInfo
    }
  }

  export function define<Parameters extends z.ZodType, Result extends Metadata>(
    id: string,
    init: ((ctx?: InitContext) => Promise<Def<Parameters, Result>>) | Def<Parameters, Result>,
  ): Info<Parameters, Result> {
    return {
      id,
      init: wrap(id, init),
    }
  }

  export function defineEffect<Parameters extends z.ZodType, Result extends Metadata, R>(
    id: string,
    init: Effect.Effect<((ctx?: InitContext) => Promise<Def<Parameters, Result>>) | Def<Parameters, Result>, never, R>,
  ): Effect.Effect<Info<Parameters, Result>, never, R> {
    return Effect.map(init, (next) => ({ id, init: wrap(id, next) }))
  }
}
