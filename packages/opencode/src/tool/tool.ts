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
        attachments?: MessageV2.FilePart[]
      }>
      formatValidationError?(error: z.ZodError): string
    }>
  }

  export type InferParameters<T extends Info> = T extends Info<infer P> ? z.infer<P> : never
  export type InferMetadata<T extends Info> = T extends Info<any, infer M> ? M : never

  function coerceStringValues(input: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input)) {
      if (typeof value !== "string") {
        result[key] = value
        continue
      }
      if (/^[\[{]/.test(value)) {
        try {
          result[key] = JSON.parse(value)
          continue
        } catch {}
      }
      if (/^-?\d+(\.\d+)?$/.test(value)) {
        result[key] = Number(value)
        continue
      }
      if (value === "true" || value === "false") {
        result[key] = value === "true"
        continue
      }
      result[key] = value
    }
    return result
  }

  export function define<Parameters extends z.ZodType, Result extends Metadata>(
    id: string,
    init: Info<Parameters, Result>["init"] | Awaited<ReturnType<Info<Parameters, Result>["init"]>>,
  ): Info<Parameters, Result> {
    id = id.replace(/\w\S*/g, (text) => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase())
    return {
      id,
      init: async (initCtx) => {
        const toolInfo = init instanceof Function ? await init(initCtx) : init
        const originalExecute = toolInfo.execute
        toolInfo.execute = async (args, ctx) => {
          const firstTry = toolInfo.parameters.safeParse(args)

          if (firstTry.success) {
            const result = await originalExecute(args, ctx)
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

          const hasCoercibleTypeError = firstTry.error.issues.some((issue) => {
            if (issue.code !== "invalid_type") return false
            const expected = (issue as { expected?: string }).expected
            return expected === "array" || expected === "object" || expected === "number" || expected === "boolean"
          })

          if (hasCoercibleTypeError) {
            const coercedArgs = coerceStringValues(args as Record<string, unknown>)
            const secondTry = toolInfo.parameters.safeParse(coercedArgs)

            if (secondTry.success) {
              const result = await originalExecute(coercedArgs as z.infer<Parameters>, ctx)
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
          }

          if (toolInfo.formatValidationError) {
            throw new Error(toolInfo.formatValidationError(firstTry.error), { cause: firstTry.error })
          }
          throw new Error(
            `The ${id} tool was called with invalid arguments: ${firstTry.error}.\nPlease rewrite the input so it satisfies the expected schema.`,
            { cause: firstTry.error },
          )
        }
        return toolInfo
      },
    }
  }
}
