import { type LanguageModelV2CallOptions, type LanguageModelV2CallWarning } from "@ai-sdk/provider";
export declare function prepareTools({ tools, toolChoice }: {
    tools: LanguageModelV2CallOptions["tools"];
    toolChoice?: LanguageModelV2CallOptions["toolChoice"];
}): {
    tools: undefined | Array<{
        type: "function";
        function: {
            name: string;
            description: string | undefined;
            parameters: unknown;
        };
    }>;
    toolChoice: {
        type: "function";
        function: {
            name: string;
        };
    } | "auto" | "none" | "required" | undefined;
    toolWarnings: LanguageModelV2CallWarning[];
};
