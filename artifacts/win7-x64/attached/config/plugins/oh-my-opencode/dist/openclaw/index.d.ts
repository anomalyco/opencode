import { startReplyListener, stopReplyListener } from "./reply-listener";
import type { OpenClawConfig, OpenClawContext, WakeResult } from "./types";
export declare function wakeOpenClaw(config: OpenClawConfig, event: string, context: OpenClawContext): Promise<WakeResult | null>;
export declare function initializeOpenClaw(config: OpenClawConfig): Promise<void>;
export { startReplyListener, stopReplyListener };
