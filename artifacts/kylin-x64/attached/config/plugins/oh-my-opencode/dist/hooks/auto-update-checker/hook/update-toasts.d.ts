import type { PluginInput } from "@opencode-ai/plugin";
export declare function showUpdateAvailableToast(ctx: PluginInput, latestVersion: string, getToastMessage: (isUpdate: boolean, latestVersion?: string) => string): Promise<void>;
export declare function showAutoUpdatedToast(ctx: PluginInput, oldVersion: string, newVersion: string): Promise<void>;
