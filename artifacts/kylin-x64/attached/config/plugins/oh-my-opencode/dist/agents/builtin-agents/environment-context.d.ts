import type { AgentConfig } from "@opencode-ai/sdk";
type ApplyEnvironmentContextOptions = {
    disableOmoEnv?: boolean;
};
export declare function applyEnvironmentContext(config: AgentConfig, directory?: string, options?: ApplyEnvironmentContextOptions): AgentConfig;
export {};
