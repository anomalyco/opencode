import type { PluginInput } from "@opencode-ai/plugin";
export type Platform = "darwin" | "linux" | "win32" | "unsupported";
export declare function detectPlatform(): Platform;
export declare function getDefaultSoundPath(platform: Platform): string;
export declare function sendSessionNotification(ctx: PluginInput, platform: Platform, title: string, message: string): Promise<void>;
export declare function playSessionNotificationSound(ctx: PluginInput, platform: Platform, soundPath: string): Promise<void>;
