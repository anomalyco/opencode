import { z } from "zod/v4";
export declare const webSearchPreviewArgsSchema: z.ZodObject<{
    searchContextSize: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
        medium: "medium";
    }>>;
    userLocation: z.ZodOptional<z.ZodObject<{
        type: z.ZodLiteral<"approximate">;
        country: z.ZodOptional<z.ZodString>;
        city: z.ZodOptional<z.ZodString>;
        region: z.ZodOptional<z.ZodString>;
        timezone: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const webSearchPreview: import("@ai-sdk/provider-utils").ProviderDefinedToolFactory<{}, {
    /**
     * Search context size to use for the web search.
     * - high: Most comprehensive context, highest cost, slower response
     * - medium: Balanced context, cost, and latency (default)
     * - low: Least context, lowest cost, fastest response
     */
    searchContextSize?: "high" | "low" | "medium" | undefined;
    /**
     * User location information to provide geographically relevant search results.
     */
    userLocation?: {
        /**
         * Type of location (always 'approximate')
         */
        type: "approximate";
        /**
         * Two-letter ISO country code (e.g., 'US', 'GB')
         */
        country?: string | undefined;
        /**
         * City name (free text, e.g., 'Minneapolis')
         */
        city?: string | undefined;
        /**
         * Region name (free text, e.g., 'Minnesota')
         */
        region?: string | undefined;
        /**
         * IANA timezone (e.g., 'America/Chicago')
         */
        timezone?: string | undefined;
    } | undefined;
}>;
