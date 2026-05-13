import type { LanguageModelV2FinishReason } from "@ai-sdk/provider";
export declare function mapOpenAIResponseFinishReason({ finishReason, hasFunctionCall }: {
    finishReason: string | null | undefined;
    hasFunctionCall: boolean;
}): LanguageModelV2FinishReason;
