import { createProviderDefinedToolFactoryWithOutputSchema } from "@ai-sdk/provider-utils"
import type {
  OpenAIResponsesFileSearchToolComparisonFilter,
  OpenAIResponsesFileSearchToolCompoundFilter,
} from "../openai-responses-api-types"
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

export const fileSearch = createProviderDefinedToolFactoryWithOutputSchema<
  {},
  {
    /**
     * The search query to execute.
     */
    queries: string[]

    /**
     * The results of the file search tool call.
     */
    results:
      | null
      | {
          /**
           * Set of 16 key-value pairs that can be attached to an object.
           * This can be useful for storing additional information about the object
           * in a structured format, and querying for objects via API or the dashboard.
           * Keys are strings with a maximum length of 64 characters.
           * Values are strings with a maximum length of 512 characters, booleans, or numbers.
           */
          attributes: Record<string, unknown>

          /**
           * The unique ID of the file.
           */
          fileId: string

          /**
           * The name of the file.
           */
          filename: string

          /**
           * The relevance score of the file - a value between 0 and 1.
           */
          score: number

          /**
           * The text that was retrieved from the file.
           */
          text: string
        }[]
  },
  {
    /**
     * List of vector store IDs to search through.
     */
    vectorStoreIds: string[]

    /**
     * Maximum number of search results to return. Defaults to 10.
     */
    maxNumResults?: number

    /**
     * Ranking options for the search.
     */
    ranking?: {
      /**
       * The ranker to use for the file search.
       */
      ranker?: string

      /**
       * The score threshold for the file search, a number between 0 and 1.
       * Numbers closer to 1 will attempt to return only the most relevant results,
       * but may return fewer results.
       */
      scoreThreshold?: number
    }

    /**
     * A filter to apply.
     */
    filters?: OpenAIResponsesFileSearchToolComparisonFilter | OpenAIResponsesFileSearchToolCompoundFilter
  }
>({
  id: "openai.file_search",
  name: "file_search",
  inputSchema: z.object({}),
  outputSchema: fileSearchOutputSchema,
})
