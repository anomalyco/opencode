import type { PluginInput } from "@opencode-ai/plugin";
import type { Platform } from "./session-notification-sender";
type SessionNotificationConfig = {
    playSound: boolean;
    soundPath: string;
    idleConfirmationDelay: number;
    skipIfIncompleteTodos: boolean;
    maxTrackedSessions: number;
    /** Grace period in ms to ignore late-arriving activity events after scheduling (default: 100) */
    activityGracePeriodMs?: number;
};
export declare function createIdleNotificationScheduler(options: {
    ctx: PluginInput;
    platform: Platform;
    config: SessionNotificationConfig;
    hasIncompleteTodos: (ctx: PluginInput, sessionID: string) => Promise<boolean>;
    send: (ctx: PluginInput, platform: Platform, sessionID: string) => Promise<void>;
    playSound: (ctx: PluginInput, platform: Platform, soundPath: string) => Promise<void>;
}): {
    markSessionActivity: (sessionID: string) => void;
    scheduleIdleNotification: (sessionID: string) => void;
    deleteSession: (sessionID: string) => void;
};
export {};
