import { z } from "zod"

export namespace ZenModel {
  const ModelCostSchema = z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number().optional(),
    cacheWrite5m: z.number().optional(),
    cacheWrite1h: z.number().optional(),
  })

  export const ModelSchema = z.object({
    cost: ModelCostSchema,
    cost200K: ModelCostSchema.optional(),
    allowAnonymous: z.boolean().optional(),
    providers: z.array(
      z.object({
        id: z.string(),
        api: z.string(),
        apiKey: z.string(),
        model: z.string(),
        weight: z.number().optional(),
        headerMappings: z.record(z.string(), z.string()).optional(),
        disabled: z.boolean().optional(),
      }),
    ),
  })

  export const ModelsSchema = z.record(z.string(), ModelSchema)
}
