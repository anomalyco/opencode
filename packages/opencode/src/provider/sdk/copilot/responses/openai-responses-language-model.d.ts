import { type LanguageModelV2 } from "@ai-sdk/provider";
import { z } from "zod/v4";
import type { OpenAIConfig } from "./openai-config";
import type { OpenAIResponsesModelId } from "./openai-responses-settings";
export declare class OpenAIResponsesLanguageModel implements LanguageModelV2 {
    readonly specificationVersion = "v2";
    readonly modelId: OpenAIResponsesModelId;
    private readonly config;
    constructor(modelId: OpenAIResponsesModelId, config: OpenAIConfig);
    readonly supportedUrls: Record<string, RegExp[]>;
    get provider(): string;
    private getArgs;
    doGenerate(options: Parameters<LanguageModelV2["doGenerate"]>[0]): Promise<Awaited<ReturnType<LanguageModelV2["doGenerate"]>>>;
    doStream(options: Parameters<LanguageModelV2["doStream"]>[0]): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>>;
}
declare const openaiResponsesProviderOptionsSchema: z.ZodObject<{
    include: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
        "file_search_call.results": "file_search_call.results";
        "message.output_text.logprobs": "message.output_text.logprobs";
        "reasoning.encrypted_content": "reasoning.encrypted_content";
    }>>>>;
    instructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    logprobs: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodNumber]>>;
    maxToolCalls: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    metadata: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    parallelToolCalls: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    previousResponseId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    promptCacheKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    reasoningEffort: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    reasoningSummary: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    safetyIdentifier: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    serviceTier: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        auto: "auto";
        flex: "flex";
        priority: "priority";
    }>>>;
    store: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    strictJsonSchema: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    textVerbosity: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        high: "high";
        low: "low";
        medium: "medium";
    }>>>;
    user: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export type OpenAIResponsesProviderOptions = z.infer<typeof openaiResponsesProviderOptionsSchema>;
export {};
