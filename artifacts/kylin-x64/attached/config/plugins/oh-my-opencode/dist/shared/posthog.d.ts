import { PostHog } from "posthog-node";
type PostHogCaptureEvent = Parameters<PostHog["capture"]>[0];
type PostHogExceptionProperties = Parameters<PostHog["captureException"]>[2];
type PostHogActivityReason = "run_started" | "plugin_loaded";
type PostHogClient = {
    capture: (message: PostHogCaptureEvent) => void;
    captureException: (error: unknown, distinctId?: string, additionalProperties?: PostHogExceptionProperties) => void;
    trackActive: (distinctId: string, reason: PostHogActivityReason) => void;
    shutdown: () => Promise<void>;
};
export declare function getPostHogDistinctId(): string;
export declare function createCliPostHog(): PostHogClient;
export declare function createPluginPostHog(): PostHogClient;
export {};
