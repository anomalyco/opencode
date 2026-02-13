import z from "zod"
import type { MessageV2 } from "../session/message-v2"
import type { Agent } from "../agent/agent"
import type { PermissionNext } from "../permission/next"
import { Truncate } from "./truncation"

export namespace Tool {
  interface Metadata {
    [key: string]: any
  }

  export interface InitContext {
    agent?: Agent.Info
  }

  export type Context<M extends Metadata = Metadata> = {
    sessionID: string
    messageID: string
    agent: string
    parentAgent?: string
    abort: AbortSignal
    callID?: string
    extra?: { [key: string]: any }
    messages: MessageV2.WithParts[]
    metadata(input: { title?: string; metadata?: M }): void
    ask(input: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">): Promise<void>
  }

  export interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
    id: string
    init: (ctx?: InitContext) => Promise<{
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
    }>
  }

  // resolved return type of a tool's execute() function
  export type Result = Awaited<ReturnType<Awaited<ReturnType<Info["init"]>>["execute"]>>

  export type InferParameters<T extends Info> = T extends Info<infer P> ? z.infer<P> : never
  export type InferMetadata<T extends Info> = T extends Info<any, infer M> ? M : never

  // lazy-cached to avoid circular dep: tool.ts -> plugin -> session -> tool.ts
  let plugin: typeof import("../plugin") | undefined

  // wraps tool execution with plugin before/after hooks
  export async function invoke(input: {
    tool: string
    args: unknown
    ctx: { sessionID: string; callID?: string; agent: string; parentAgent?: string }
    fn: () => Promise<Result>
  }) {
    plugin ??= await import("../plugin")
    const hook = {
      tool: input.tool,
      sessionID: input.ctx.sessionID,
      callID: input.ctx.callID ?? "",
      agent: input.ctx.agent,
      parentAgent: input.ctx.parentAgent,
    }
    await plugin.Plugin.trigger("tool.execute.before", hook, { args: input.args })
    try {
      const result = await input.fn()
      await plugin.Plugin.trigger(
        "tool.execute.after",
        { ...hook, args: input.args },
        { ...result, status: "success" as const },
      )
      return result
    } catch (error) {
      await plugin.Plugin.trigger(
        "tool.execute.after",
        { ...hook, args: input.args },
        {
          title: "",
          output: "",
          metadata: { error: error instanceof Error ? error.message : String(error) },
          status: "error" as const,
        },
      )
      throw error
    }
  }

  export function define<Parameters extends z.ZodType, Result extends Metadata>(
    id: string,
    init: Info<Parameters, Result>["init"] | Awaited<ReturnType<Info<Parameters, Result>["init"]>>,
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
