import type { RalphLoopState } from "./types";
type LoopStateController = {
    getState: () => RalphLoopState | null;
    clear: () => boolean;
};
type SessionRecovery = {
    clear: (sessionID: string) => void;
    markRecovering: (sessionID: string) => void;
};
export declare function handleDeletedLoopSession(props: Record<string, unknown> | undefined, loopState: LoopStateController, sessionRecovery: SessionRecovery): boolean;
export declare function handleErroredLoopSession(props: Record<string, unknown> | undefined, loopState: LoopStateController, sessionRecovery: SessionRecovery): boolean;
export {};
