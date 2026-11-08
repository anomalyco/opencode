import { z } from "zod/v4"

const comparisonFilterSchema = z.object({
  key: z.string(),
  type: z.enum(["eq", "ne", "gt", "gte", "lt", "lte"]),
  value: z.union([z.string(), z.number(), z.boolean()]),
})

const compoundFilterSchema: z.ZodType<any> = z.object({
  type: z.enum(["and", "or"]),
  filters: z.array(z.union([comparisonFilterSchema, z.lazy(() => compoundFilterSchema)])),
})

export const fileSearchArgsSchema = z.object({
  vectorStoreIds: z.array(z.string()),
  maxNumResults: z.number().optional(),
  ranking: z
    .object({
      ranker: z.string().optional(),
      scoreThreshold: z.number().optional(),
    })
    .optional(),
  filters: z.union([comparisonFilterSchema, compoundFilterSchema]).optional(),
})

export const fileSearchOutputSchema = z.object({
  queries: z.array(z.string()),
  results: z
    .array(
      z.object({
        attributes: z.record(z.string(), z.unknown()),
        fileId: z.string(),
        filename: z.string(),
        score: z.number(),
        text: z.string(),
      }),
    )
    .nullable(),
})
