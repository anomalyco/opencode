import { z } from "zod/v4";
export declare const webSearchArgsSchema: z.ZodObject<{
    filters: z.ZodOptional<z.ZodObject<{
        allowedDomains: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
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
export declare const webSearchToolFactory: import("@ai-sdk/provider-utils").ProviderDefinedToolFactory<{}, {
    /**
     * Filters for the search.
     */
    filters?: {
        /**
         * Allowed domains for the search.
         * If not provided, all domains are allowed.
         * Subdomains of the provided domains are allowed as well.
         */
        allowedDomains?: string[] | undefined;
    } | undefined;
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
export declare const webSearch: (args?: {
    /**
     * Filters for the search.
     */
    filters?: {
        /**
         * Allowed domains for the search.
         * If not provided, all domains are allowed.
         * Subdomains of the provided domains are allowed as well.
         */
        allowedDomains?: string[] | undefined;
    } | undefined;
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
} & {
    execute?: import("@ai-sdk/provider-utils").ToolExecuteFunction<{}, unknown> | undefined;
    toModelOutput?: ((output: unknown) => import("@ai-sdk/provider").LanguageModelV2ToolResultOutput) | undefined;
    onInputStart?: ((options: import("@ai-sdk/provider-utils").ToolCallOptions) => void | PromiseLike<void>) | undefined;
    onInputDelta?: ((options: {
        inputTextDelta: string;
    } & import("@ai-sdk/provider-utils").ToolCallOptions) => void | PromiseLike<void>) | undefined;
    onInputAvailable?: ((options: {
        input: {};
    } & import("@ai-sdk/provider-utils").ToolCallOptions) => void | PromiseLike<void>) | undefined;
}) => import("@ai-sdk/provider-utils").Tool<{}, unknown>;
