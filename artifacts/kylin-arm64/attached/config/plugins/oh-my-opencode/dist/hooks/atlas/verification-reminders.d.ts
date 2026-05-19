export declare function buildCompletionGate(planName: string, sessionId: string): string;
export declare function buildOrchestratorReminder(planName: string, progress: {
    total: number;
    completed: number;
}, sessionId: string, autoCommit?: boolean, includeCompletionGate?: boolean): string;
export declare function buildFinalWaveApprovalReminder(planName: string, progress: {
    total: number;
    completed: number;
}, sessionId: string): string;
export declare function buildStandaloneVerificationReminder(sessionId: string): string;
