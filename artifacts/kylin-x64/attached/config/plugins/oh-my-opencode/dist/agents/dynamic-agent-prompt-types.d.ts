import type { AgentPromptMetadata } from "./types";
export interface AvailableAgent {
    name: string;
    description: string;
    metadata: AgentPromptMetadata;
}
export interface AvailableTool {
    name: string;
    category: "lsp" | "ast" | "search" | "session" | "command" | "other";
}
export interface AvailableSkill {
    name: string;
    description: string;
    location: "user" | "project" | "plugin";
}
export interface AvailableCategory {
    name: string;
    description: string;
    model?: string;
}
