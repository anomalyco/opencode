import type { PendingCall } from "./types";
import { runCommentChecker } from "./cli";
export declare function initializeCommentCheckerCli(debugLog: (...args: unknown[]) => void): void;
export declare function getCommentCheckerCliPathPromise(): Promise<string | null> | null;
export declare function processWithCli(input: {
    tool: string;
    sessionID: string;
    callID: string;
}, pendingCall: PendingCall, output: {
    output: string;
}, cliPath: string, customPrompt: string | undefined, debugLog: (...args: unknown[]) => void, deps?: {
    runCommentChecker?: typeof runCommentChecker;
}): Promise<void>;
export interface ApplyPatchEdit {
    filePath: string;
    before: string;
    after: string;
}
export declare function processApplyPatchEditsWithCli(sessionID: string, edits: ApplyPatchEdit[], output: {
    output: string;
}, cliPath: string, customPrompt: string | undefined, debugLog: (...args: unknown[]) => void): Promise<void>;
export declare function isCliPathUsable(cliPath: string | null): cliPath is string;
