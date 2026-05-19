import type { PluginInput } from "@opencode-ai/plugin";
import type { createDynamicTruncator } from "../../shared/dynamic-truncator";
type DynamicTruncator = ReturnType<typeof createDynamicTruncator>;
export declare function processFilePathForReadmeInjection(input: {
    ctx: PluginInput;
    truncator: DynamicTruncator;
    sessionCaches: Map<string, Set<string>>;
    filePath: string;
    sessionID: string;
    output: {
        title: string;
        output: string;
        metadata: unknown;
    };
}): Promise<void>;
export {};
