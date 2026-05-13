import type { PluginInput } from "@opencode-ai/plugin";
export declare function showVersionToast(ctx: PluginInput, version: string | null, message: string): Promise<void>;
export declare function showLocalDevToast(ctx: PluginInput, version: string | null, isSisyphusEnabled: boolean): Promise<void>;
