import z from "zod/v4"

export namespace Tool {
  export type Metadata = Record<string, unknown>
  export type Extra = Record<string, unknown>
  export type MetadataInput<M extends Metadata> = {
    title?: string
    metadata?: M
  }
  export type Context<M extends Metadata = Metadata, E extends Extra = Extra> = {
    sessionID: string
    messageID: string
    agent: string
    abort: AbortSignal
    callID?: string
    extra?: E
    metadata(input: MetadataInput<M>): void
  }
  export interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata, E extends Extra = Extra> {
    id: string
    init: () => Promise<{
      description: string
      parameters: Parameters
      execute(
        args: z.infer<Parameters>,
        ctx: Context<M, E>,
      ): Promise<{
        title: string
        metadata: M
        output: string
      }>
    }>
  }

  export function define<Parameters extends z.ZodType, Result extends Metadata, E extends Extra = Extra>(
    id: string,
    init:
      | Info<Parameters, Result, E>["init"]
      | Awaited<ReturnType<Info<Parameters, Result, E>["init"]>>,
  ): Info<Parameters, Result, E> {
    return {
      id,
      init: async () => {
        if (init instanceof Function) return init()
        return init
      },
    }
  }
}
