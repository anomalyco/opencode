import type { CompactionAgentConfigCheckpoint } from "../../shared/compaction-agent-config-checkpoint";
export type RecoveryPromptConfig = CompactionAgentConfigCheckpoint & {
    agent: string;
};
export declare function createExpectedRecoveryPromptConfig(checkpoint: Pick<RecoveryPromptConfig, "agent"> & CompactionAgentConfigCheckpoint, currentPromptConfig: CompactionAgentConfigCheckpoint): RecoveryPromptConfig;
export declare function isPromptConfigRecovered(actualPromptConfig: CompactionAgentConfigCheckpoint, expectedPromptConfig: RecoveryPromptConfig): boolean;
