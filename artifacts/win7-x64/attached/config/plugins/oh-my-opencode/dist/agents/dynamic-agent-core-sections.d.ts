import type { AvailableAgent, AvailableCategory, AvailableSkill } from "./dynamic-agent-prompt-types";
import type { AvailableTool } from "./dynamic-agent-prompt-types";
/**
 * Builds an explicit agent identity preamble that overrides any base system prompt identity.
 * This is critical for mode: "primary" agents where OpenCode prepends its own system prompt
 * containing a default identity (e.g., "You are Claude"). Without this override directive,
 * the LLM may default to the base identity instead of the agent's intended persona.
 */
export declare function buildAgentIdentitySection(agentName: string, roleDescription: string): string;
export declare function buildKeyTriggersSection(agents: AvailableAgent[], _skills?: AvailableSkill[]): string;
export declare function buildToolSelectionTable(agents: AvailableAgent[], tools?: AvailableTool[], _skills?: AvailableSkill[]): string;
export declare function buildExploreSection(agents: AvailableAgent[]): string;
export declare function buildLibrarianSection(agents: AvailableAgent[]): string;
export declare function buildDelegationTable(agents: AvailableAgent[]): string;
export declare function buildOracleSection(agents: AvailableAgent[]): string;
export declare function buildNonClaudePlannerSection(model: string): string;
export declare function buildParallelDelegationSection(model: string, categories: AvailableCategory[]): string;
