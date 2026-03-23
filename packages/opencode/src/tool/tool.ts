import z from "zod"
import type { JSONSchema7 } from "ai"
import type { MessageV2 } from "../session/message-v2"
import type { Agent } from "../agent/agent"
import type { Permission } from "../permission"
import type { SessionID, MessageID } from "../session/schema"
import { Truncate } from "./truncate"

export namespace Tool {
  interface Metadata {
    [key: string]: any
  }

  /** Union of supported parameter representations */
  export type ParameterSchema = z.ZodType | JSONSchema7

  export interface InitContext {
    agent?: Agent.Info
  }

  export type Context<M extends Metadata = Metadata> = {
    sessionID: SessionID
    messageID: MessageID
    agent: string
    abort: AbortSignal
    callID?: string
    callChain?: string[]
    extra?: { [key: string]: any }
    messages: MessageV2.WithParts[]
    metadata(input: { title?: string; metadata?: M }): void
    ask(input: Omit<Permission.Request, "id" | "sessionID" | "tool">): Promise<void>
  }
  export interface Info<Parameters extends ParameterSchema = z.ZodType, M extends Metadata = Metadata> {
    id: string
    /** Tool origin source */
    readonly source?: "builtin" | "mcp" | "plugin" | "custom"
    init: (ctx?: InitContext) => Promise<ResolvedToolInfo<Parameters, M>>
  }

  export interface ResolvedToolInfo<Parameters extends ParameterSchema = z.ZodType, M extends Metadata = Metadata> {
    description: string
    parameters: Parameters
    execute(
      args: Parameters extends z.ZodType ? z.infer<Parameters> : never,
      ctx: Context,
    ): Promise<{
      title: string
      metadata: M
      output: string
      attachments?: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[]
    }>
    formatValidationError?(error: z.ZodError): string
  }

  export type InferParameters<T extends Info> =
    T extends Info<infer P> ? (P extends z.ZodType ? z.infer<P> : never) : never
  export type InferMetadata<T extends Info> = T extends Info<any, infer M> ? M : never

  export function define<Parameters extends ParameterSchema, Result extends Metadata>(
    id: string,
    init: Info<Parameters, Result>["init"] | Awaited<ReturnType<Info<Parameters, Result>["init"]>>,
    opts?: { source?: Info["source"] },
  ): Info<Parameters, Result> {
    return {
      id,
      source: opts?.source,
      init: async (initCtx) => {
        const toolInfo = init instanceof Function ? await init(initCtx) : init
        const execute = toolInfo.execute
        toolInfo.execute = async (args, ctx) => {
          // Only apply Zod validation for Zod schemas; skip for JSON Schema
          if (toolInfo.parameters instanceof z.ZodType) {
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
          }
          const result = await execute(args, ctx)
          // skip truncation for tools that handle it themselves
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
      },
    }
  }
}
