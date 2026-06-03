import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentPromptMetadata } from "./types";
export declare const ORACLE_PROMPT_METADATA: AgentPromptMetadata;
export declare function createOracleAgent(model: string): AgentConfig;
export declare namespace createOracleAgent {
    var mode: "subagent";
}
