import type { PluginInput } from "@opencode-ai/plugin";
type OpencodeClient = PluginInput["client"];
export declare function waitForSessionReady(params: {
    client: OpencodeClient;
    sessionId: string;
}): Promise<boolean>;
export {};
