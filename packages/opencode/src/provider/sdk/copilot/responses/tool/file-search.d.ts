import type { OpenAIResponsesFileSearchToolComparisonFilter, OpenAIResponsesFileSearchToolCompoundFilter } from "../openai-responses-api-types";
import { z } from "zod/v4";
export declare const fileSearchArgsSchema: z.ZodObject<{
    vectorStoreIds: z.ZodArray<z.ZodString>;
    maxNumResults: z.ZodOptional<z.ZodNumber>;
    ranking: z.ZodOptional<z.ZodObject<{
        ranker: z.ZodOptional<z.ZodString>;
        scoreThreshold: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    filters: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
        key: z.ZodString;
        type: z.ZodEnum<{
            eq: "eq";
            gt: "gt";
            gte: "gte";
            lt: "lt";
            lte: "lte";
            ne: "ne";
        }>;
        value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
    }, z.core.$strip>, z.ZodType<any, unknown, z.core.$ZodTypeInternals<any, unknown>>]>>;
}, z.core.$strip>;
export declare const fileSearchOutputSchema: z.ZodObject<{
    queries: z.ZodArray<z.ZodString>;
    results: z.ZodNullable<z.ZodArray<z.ZodObject<{
        attributes: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        fileId: z.ZodString;
        filename: z.ZodString;
        score: z.ZodNumber;
        text: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const fileSearch: import("@ai-sdk/provider-utils").ProviderDefinedToolFactoryWithOutputSchema<{}, {
    /**
     * The search query to execute.
     */
    queries: string[];
    /**
     * The results of the file search tool call.
     */
    results: {
        /**
         * Set of 16 key-value pairs that can be attached to an object.
         * This can be useful for storing additional information about the object
         * in a structured format, and querying for objects via API or the dashboard.
         * Keys are strings with a maximum length of 64 characters.
         * Values are strings with a maximum length of 512 characters, booleans, or numbers.
         */
        attributes: Record<string, unknown>;
        /**
         * The unique ID of the file.
         */
        fileId: string;
        /**
         * The name of the file.
         */
        filename: string;
        /**
         * The relevance score of the file - a value between 0 and 1.
         */
        score: number;
        /**
         * The text that was retrieved from the file.
         */
        text: string;
    }[] | null;
}, {
    /**
     * List of vector store IDs to search through.
     */
    vectorStoreIds: string[];
    /**
     * Maximum number of search results to return. Defaults to 10.
     */
    maxNumResults?: number | undefined;
    /**
     * Ranking options for the search.
     */
    ranking?: {
        /**
         * The ranker to use for the file search.
         */
        ranker?: string | undefined;
        /**
         * The score threshold for the file search, a number between 0 and 1.
         * Numbers closer to 1 will attempt to return only the most relevant results,
         * but may return fewer results.
         */
        scoreThreshold?: number | undefined;
    } | undefined;
    /**
     * A filter to apply.
     */
    filters?: OpenAIResponsesFileSearchToolComparisonFilter | OpenAIResponsesFileSearchToolCompoundFilter | undefined;
}>;
