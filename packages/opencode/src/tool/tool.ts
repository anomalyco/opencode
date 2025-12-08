import z from "zod"
import type { MessageV2 } from "../session/message-v2"
import { Tracing } from "../tracing"

export namespace Tool {
  interface Metadata {
    [key: string]: any
  }

  export type Context<M extends Metadata = Metadata> = {
    sessionID: string
    messageID: string
    agent: string
    abort: AbortSignal
    callID?: string
    extra?: { [key: string]: any }
    metadata(input: { title?: string; metadata?: M }): void
  }
  export interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
    id: string
    init: () => Promise<{
      description: string
      parameters: Parameters
      execute(
        args: z.infer<Parameters>,
        ctx: Context,
      ): Promise<{
        title: string
        metadata: M
        output: string
        attachments?: MessageV2.FilePart[]
      }>
      formatValidationError?(error: z.ZodError): string
    }>
  }

  export type InferParameters<T extends Info> = T extends Info<infer P> ? z.infer<P> : never
  export type InferMetadata<T extends Info> = T extends Info<any, infer M> ? M : never

  export function define<Parameters extends z.ZodType, Result extends Metadata>(
    id: string,
    init: Info<Parameters, Result>["init"] | Awaited<ReturnType<Info<Parameters, Result>["init"]>>,
  ): Info<Parameters, Result> {
    return {
      id,
      init: async () => {
        const toolInfo = init instanceof Function ? await init() : init
        const execute = toolInfo.execute
        toolInfo.execute = (args, ctx) => {
          return Tracing.startSpan(`tool.${id}`, async () => {
            Tracing.setAttributes({
              "tool.id": id,
              "tool.session_id": ctx.sessionID,
              "tool.message_id": ctx.messageID,
              "tool.agent": ctx.agent,
            })
            try {
              toolInfo.parameters.parse(args)
            } catch (error) {
              if (error instanceof z.ZodError && toolInfo.formatValidationError) {
                Tracing.recordError(error as Error)
                throw new Error(toolInfo.formatValidationError(error), { cause: error })
              }
              Tracing.recordError(error as Error)
              throw new Error(
                `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
                { cause: error },
              )
            }
            const result = await execute(args, ctx)
            Tracing.addEvent("tool.completed", { "tool.id": id })
            return result
          })
        }
        return toolInfo
      },
    }
  }
}
