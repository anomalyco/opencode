import type { PluginInput } from "@opencode-ai/plugin";
export declare function extractSessionIdFromMetadata(metadata: unknown): string | undefined;
export declare function extractSessionIdFromOutput(output: string): string | undefined;
export declare function validateSubagentSessionId(input: {
    client: PluginInput["client"];
    sessionID?: string;
    lineageSessionIDs: string[];
}): Promise<string | undefined>;
