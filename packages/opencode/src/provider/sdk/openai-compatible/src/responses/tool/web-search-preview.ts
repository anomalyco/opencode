import { createProviderDefinedToolFactory } from "@ai-sdk/provider-utils"
import { z } from "zod/v4"

// Args validation schema
export const webSearchPreviewArgsSchema = z.object({
  /**
   * Search context size to use for the web search.
   * - high: Most comprehensive context, highest cost, slower response
   * - medium: Balanced context, cost, and latency (default)
   * - low: Least context, lowest cost, fastest response
   */
  searchContextSize: z.enum(["low", "medium", "high"]).optional(),

  /**
   * User location information to provide geographically relevant search results.
   */
  userLocation: z
    .object({
      /**
       * Type of location (always 'approximate')
       */
      type: z.literal("approximate"),
      /**
       * Two-letter ISO country code (e.g., 'US', 'GB')
       */
      country: z.string().optional(),
      /**
       * City name (free text, e.g., 'Minneapolis')
       */
      city: z.string().optional(),
      /**
       * Region name (free text, e.g., 'Minnesota')
       */
      region: z.string().optional(),
      /**
       * IANA timezone (e.g., 'America/Chicago')
       */
      timezone: z.string().optional(),
    })
    .optional(),
})

export const webSearchPreview = createProviderDefinedToolFactory<
  {
    // Web search doesn't take input parameters - it's controlled by the prompt
  },
  {
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
  id: "openai.web_search_preview",
  name: "web_search_preview",
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
