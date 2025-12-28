import { createProviderDefinedToolFactory } from "@ai-sdk/provider-utils"
import { z } from "zod/v4"

export const webSearchArgsSchema = z.object({
  filters: z
    .object({
      allowedDomains: z.array(z.string()).optional(),
    })
    .optional(),

  searchContextSize: z.enum(["low", "medium", "high"]).optional(),

  userLocation: z
    .object({
      type: z.literal("approximate"),
      country: z.string().optional(),
      city: z.string().optional(),
      region: z.string().optional(),
      timezone: z.string().optional(),
    })
    .optional(),
})

export const webSearchToolFactory = createProviderDefinedToolFactory<
  {
    // Web search doesn't take input parameters - it's controlled by the prompt
  },
  {
    /**
     * Filters for the search.
     */
    filters?: {
      /**
       * Allowed domains for the search.
       * If not provided, all domains are allowed.
       * Subdomains of the provided domains are allowed as well.
       */
      allowedDomains?: string[]
    }

    /**
     * Search context size to use for the web search.
     * - high: Most comprehensive context, highest cost, slower response
     * - medium: Balanced context, cost, and latency (default)
     * - low: Least context, lowest cost, fastest response
     */
    searchContextSize?: "low" | "medium" | "high"

    /**
     * User location information to provide geographically relevant search results.
     */
    userLocation?: {
      /**
       * Type of location (always 'approximate')
       */
      type: "approximate"
      /**
       * Two-letter ISO country code (e.g., 'US', 'GB')
       */
      country?: string
      /**
       * City name (free text, e.g., 'Minneapolis')
       */
      city?: string
      /**
       * Region name (free text, e.g., 'Minnesota')
       */
      region?: string
      /**
       * IANA timezone (e.g., 'America/Chicago')
       */
      timezone?: string
    }
  }
>({
  id: "openai.web_search",
  name: "web_search",
  inputSchema: z.object({
    action: z
      .discriminatedUnion("type", [
        z.object({
          type: z.literal("search"),
          query: z.string().nullish(),
        }),
        z.object({
          type: z.literal("open_page"),
          url: z.string(),
        }),
        z.object({
          type: z.literal("find"),
          url: z.string(),
          pattern: z.string(),
        }),
      ])
      .nullish(),
  }),
})

export const webSearch = (
  args: Parameters<typeof webSearchToolFactory>[0] = {}, // default
) => {
  return webSearchToolFactory(args)
}
