import type { PluginInput } from "@opencode-ai/plugin";
export declare function handleWriteExistingFileGuardToolExecuteBefore(params: {
    ctx: PluginInput;
    input: {
        tool?: string;
        sessionID?: string;
    };
    output: {
        args?: unknown;
    };
    readPermissionsBySession: Map<string, Set<string>>;
    sessionLastAccess: Map<string, number>;
    canonicalSessionRoot: string;
    maxTrackedSessions: number;
}): Promise<void>;
