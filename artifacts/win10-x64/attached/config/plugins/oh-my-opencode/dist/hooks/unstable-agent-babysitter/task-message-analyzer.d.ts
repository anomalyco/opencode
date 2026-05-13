import type { BackgroundTask } from "../../features/background-agent";
export declare const THINKING_SUMMARY_MAX_CHARS: 500;
type MessageInfo = {
    role?: string;
    agent?: string;
    model?: {
        providerID: string;
        modelID: string;
        variant?: string;
    };
    providerID?: string;
    modelID?: string;
    tools?: Record<string, boolean | "allow" | "deny" | "ask">;
};
type MessagePart = {
    type?: string;
    text?: string;
    thinking?: string;
};
export declare function getMessageInfo(value: unknown): MessageInfo | undefined;
export declare function getMessageParts(value: unknown): MessagePart[];
export declare function extractMessages(value: unknown): unknown[];
export declare function isUnstableTask(task: BackgroundTask): boolean;
export declare function buildReminder(task: BackgroundTask, summary: string | null, idleMs: number): string;
export {};
