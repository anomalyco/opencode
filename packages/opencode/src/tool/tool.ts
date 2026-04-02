import z from "zod"
import type { MessageV2 } from "../session/message-v2"
import type { Agent } from "../agent/agent"
import type { Permission } from "../permission"
import type { SessionID, MessageID } from "../session/schema"
import { Truncate } from "./truncate"
import { abortAfterAny, raceSignal } from "../util/abort"
import { Config } from "../config/config"

const TOOL_TIMEOUT = 15 * 60 * 1000

/** Compute the effective timeout for a non-task tool execution. Exported for testing. */
export function timeout(input: { tool?: number }): number {
  return input.tool ?? TOOL_TIMEOUT
}

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

  export type InferParameters<T extends Info> = T extends Info<infer P> ? z.infer<P> : never
  export type InferMetadata<T extends Info> = T extends Info<any, infer M> ? M : never

  export function define<Parameters extends z.ZodType, Result extends Metadata>(
    id: string,
    init: Info<Parameters, Result>["init"] | Def<Parameters, Result>,
  ): Info<Parameters, Result> {
    return {
      id,
      init: async (initCtx) => {
        const toolInfo = init instanceof Function ? await init(initCtx) : init
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
          // Task tool manages its own deadline inside task.ts — skip the
          // outer raceSignal wrapper so nested tasks aren't starved of time.
          if (id === "task") {
            const result = await execute(args, ctx)
            if (result.metadata.truncated !== undefined) return result
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

          let ms = TOOL_TIMEOUT
          try {
            const cfg = await Config.get()
            ms = timeout({ tool: cfg.experimental?.tool_timeout })
          } catch {
            // No Instance context (e.g., unit tests) — use hardcoded default
          }
          const deadline = abortAfterAny(ms, ctx.abort)
          try {
            const result = await raceSignal(
              execute(args, { ...ctx, abort: deadline.signal }),
              deadline.signal,
              `Tool execution exceeded ${Math.round(ms / 1000)}s global timeout`,
            )
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
          } finally {
            deadline.clearTimeout()
          }
        }
        return toolInfo
      },
    }
  }
}
