import type { PendingCall } from "./types";
export declare function startPendingCallCleanup(): void;
export declare function stopPendingCallCleanup(): void;
export declare function registerPendingCall(callID: string, pendingCall: PendingCall): void;
export declare function takePendingCall(callID: string): PendingCall | undefined;
