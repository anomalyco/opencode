import type { v1 } from "@standard-schema/spec"

export namespace Tool {
  interface Metadata {
    [key: string]: any
  }
  export type Context<M extends Metadata = Metadata> = {
    sessionID: string
    messageID: string
    abort: AbortSignal
    metadata(input: { title?: string; metadata?: M }): void
  }
  export interface Info<Parameters extends v1.StandardSchema = v1.StandardSchema, M extends Metadata = Metadata> {
    id: string
    description: string
    parameters: Parameters
    execute(
      args: v1.InferOutput<Parameters>,
      ctx: Context,
    ): Promise<{
      title: string
      metadata: M
      output: string
    }>
  }

  export function define<Parameters extends v1.StandardSchema, Result extends Metadata>(
    input: Info<Parameters, Result>,
  ): Info<Parameters, Result> {
    return input
  }
}
