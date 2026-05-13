import type { OpenClawConfig } from "./types";
export declare function sanitizeReplyInput(text: string): string;
export declare class ReplyListenerRateLimiter {
    private readonly maxPerMinute;
    private readonly timestamps;
    private readonly windowMs;
    constructor(maxPerMinute: number);
    canProceed(): boolean;
}
export declare function injectReplyIntoPane(paneId: string, text: string, platform: string, config: OpenClawConfig): Promise<boolean>;
