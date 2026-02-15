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

  export type InferParameters<T extends Info> = T extends Info<infer P> ? z.infer<P> : never
  export type InferMetadata<T extends Info> = T extends Info<any, infer M> ? M : never

  export type Result = Awaited<ReturnType<Awaited<ReturnType<Info["init"]>>["execute"]>>

  let pending: Promise<typeof import("../plugin")> | undefined
  export async function invoke(input: {
    tool: string
    sessionID: string
    callID?: string
    agent?: string
    args: any
    fn: () => Promise<Result | undefined>
  }): Promise<Result | undefined> {
    pending ??= import("../plugin")
    const { Plugin } = await pending
    await Plugin.trigger(
      "tool.execute.before",
      {
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.callID ?? "",
        agent: input.agent,
      },
      { args: input.args },
    )
    let result: Result | undefined
    try {
      result = await input.fn()
    } catch (e) {
      await Plugin.trigger(
        "tool.execute.after",
        {
          tool: input.tool,
          sessionID: input.sessionID,
          callID: input.callID ?? "",
          args: input.args,
          agent: input.agent,
        },
        { title: "", output: "", metadata: { error: e }, status: "error" as const },
      )
      throw e
    }
    await Plugin.trigger(
      "tool.execute.after",
      {
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.callID ?? "",
        args: input.args,
        agent: input.agent,
      },
      result
        ? { ...result, status: "success" as const }
        : { title: "", output: "", metadata: {}, status: "error" as const },
    )
    return result
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
