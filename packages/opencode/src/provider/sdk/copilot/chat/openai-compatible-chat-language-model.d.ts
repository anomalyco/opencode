import { type LanguageModelV2 } from "@ai-sdk/provider";
import { type FetchFunction } from "@ai-sdk/provider-utils";
import { type OpenAICompatibleChatModelId } from "./openai-compatible-chat-options";
import { type ProviderErrorStructure } from "../openai-compatible-error";
import type { MetadataExtractor } from "./openai-compatible-metadata-extractor";
export type OpenAICompatibleChatConfig = {
    provider: string;
    headers: () => Record<string, string | undefined>;
    url: (options: {
        modelId: string;
        path: string;
    }) => string;
    fetch?: FetchFunction;
    includeUsage?: boolean;
    errorStructure?: ProviderErrorStructure<any>;
    metadataExtractor?: MetadataExtractor;
    /**
     * Whether the model supports structured outputs.
     */
    supportsStructuredOutputs?: boolean;
    /**
     * The supported URLs for the model.
     */
    supportedUrls?: () => LanguageModelV2["supportedUrls"];
};
export declare class OpenAICompatibleChatLanguageModel implements LanguageModelV2 {
    readonly specificationVersion = "v2";
    readonly supportsStructuredOutputs: boolean;
    readonly modelId: OpenAICompatibleChatModelId;
    private readonly config;
    private readonly failedResponseHandler;
    private readonly chunkSchema;
    constructor(modelId: OpenAICompatibleChatModelId, config: OpenAICompatibleChatConfig);
    get provider(): string;
    private get providerOptionsName();
    get supportedUrls(): PromiseLike<Record<string, RegExp[]>> | Record<string, RegExp[]>;
    private getArgs;
    doGenerate(options: Parameters<LanguageModelV2["doGenerate"]>[0]): Promise<Awaited<ReturnType<LanguageModelV2["doGenerate"]>>>;
    doStream(options: Parameters<LanguageModelV2["doStream"]>[0]): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>>;
}
