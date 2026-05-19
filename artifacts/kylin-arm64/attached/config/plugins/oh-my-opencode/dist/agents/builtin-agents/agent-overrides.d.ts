import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentOverrideConfig } from "../types";
import type { CategoryConfig } from "../../config/schema";
/**
 * Expands a category reference from an agent override into concrete config properties.
 * Category properties are applied unconditionally (overwriting factory defaults),
 * because the user's chosen category should take priority over factory base values.
 * Direct override properties applied later via mergeAgentConfig() will supersede these.
 */
export declare function applyCategoryOverride(config: AgentConfig, categoryName: string, mergedCategories: Record<string, CategoryConfig>): AgentConfig;
export declare function mergeAgentConfig(base: AgentConfig, override: AgentOverrideConfig, directory?: string): AgentConfig;
export declare function applyOverrides(config: AgentConfig, override: AgentOverrideConfig | undefined, mergedCategories: Record<string, CategoryConfig>, directory?: string): AgentConfig;
