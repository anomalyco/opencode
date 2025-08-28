import type { StandardSchemaV1 } from "@standard-schema/spec"

export namespace Tool {
  interface Metadata {
    [key: string]: any
  }
  export type Context<M extends Metadata = Metadata> = {
    sessionID: string
    messageID: string
    agent: string
    callID?: string
    abort: AbortSignal
    extra?: { [key: string]: any }
    metadata(input: { title?: string; metadata?: M }): void
  }
  export interface Info<Parameters extends StandardSchemaV1 = StandardSchemaV1, M extends Metadata = Metadata> {
    id: string
    init: () => Promise<{
      description: string
      parameters: Parameters
      execute(
        args: StandardSchemaV1.InferOutput<Parameters>,
        ctx: Context,
      ): Promise<{
        title: string
        metadata: M
        output: string
      }>
    }>
  }

  export function define<Parameters extends StandardSchemaV1, Result extends Metadata>(
    id: string,
    init: Info<Parameters, Result>["init"] | Awaited<ReturnType<Info<Parameters, Result>["init"]>>,
  ): Info<Parameters, Result> {
    return {
      id,
      init: async () => {
        if (init instanceof Function) return init()
        return init
      },
    }
  }
}
