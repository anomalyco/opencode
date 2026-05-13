import { type LanguageModelV2CallOptions, type LanguageModelV2CallWarning } from "@ai-sdk/provider";
import type { OpenAIResponsesTool } from "./openai-responses-api-types";
export declare function prepareResponsesTools({ tools, toolChoice, strictJsonSchema }: {
    tools: LanguageModelV2CallOptions["tools"];
    toolChoice?: LanguageModelV2CallOptions["toolChoice"];
    strictJsonSchema: boolean;
}): {
    tools?: Array<OpenAIResponsesTool>;
    toolChoice?: "auto" | "none" | "required" | {
        type: "file_search";
    } | {
        type: "web_search_preview";
    } | {
        type: "web_search";
    } | {
        type: "function";
        name: string;
    } | {
        type: "code_interpreter";
    } | {
        type: "image_generation";
    };
    toolWarnings: LanguageModelV2CallWarning[];
};
