import type { PluginInput } from "@opencode-ai/plugin";
export declare function isSessionInBoulderLineage(input: {
    client: PluginInput["client"];
    sessionID: string;
    boulderSessionIDs: string[];
}): Promise<boolean>;
