import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentPromptMetadata } from "./types";
export declare const LIBRARIAN_PROMPT_METADATA: AgentPromptMetadata;
export declare function createLibrarianAgent(model: string): AgentConfig;
export declare namespace createLibrarianAgent {
    var mode: "subagent";
}
