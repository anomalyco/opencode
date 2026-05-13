import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentPromptMetadata } from "./types";
export declare const MULTIMODAL_LOOKER_PROMPT_METADATA: AgentPromptMetadata;
export declare function createMultimodalLookerAgent(model: string): AgentConfig;
export declare namespace createMultimodalLookerAgent {
    var mode: "subagent";
}
