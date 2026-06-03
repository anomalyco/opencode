export type CompactionAgentConfigCheckpoint = {
    agent?: string;
    model?: {
        providerID: string;
        modelID: string;
    };
    tools?: Record<string, boolean>;
};
export declare function setCompactionAgentConfigCheckpoint(sessionID: string, checkpoint: CompactionAgentConfigCheckpoint): void;
export declare function getCompactionAgentConfigCheckpoint(sessionID: string): CompactionAgentConfigCheckpoint | undefined;
export declare function clearCompactionAgentConfigCheckpoint(sessionID: string): void;
