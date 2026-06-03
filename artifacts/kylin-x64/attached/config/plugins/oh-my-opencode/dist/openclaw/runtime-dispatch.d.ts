import type { OpenClawConfig, WakeResult } from "./types";
interface DispatchOpenClawContext {
    sessionId?: string;
    projectPath?: string;
    tmuxPaneId?: string;
    tmuxSession?: string;
    replyChannel?: string;
    replyTarget?: string;
    replyThread?: string;
}
interface DispatchOpenClawEventParams {
    config: OpenClawConfig;
    rawEvent: string;
    context: DispatchOpenClawContext;
}
export declare function dispatchOpenClawEvent(params: DispatchOpenClawEventParams): Promise<WakeResult | null>;
export {};
