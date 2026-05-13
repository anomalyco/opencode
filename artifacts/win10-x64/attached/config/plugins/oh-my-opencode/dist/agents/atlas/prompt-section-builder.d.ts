/**
 * Atlas Orchestrator - Shared Utilities
 *
 * Common functions for building dynamic prompt sections used by both
 * default (Claude-optimized) and GPT-optimized prompts.
 */
import type { CategoryConfig } from "../../config/schema";
import type { AvailableAgent, AvailableSkill } from "../dynamic-agent-prompt-builder";
export declare const getCategoryDescription: (name: string, userCategories?: Record<string, CategoryConfig>) => string;
export declare function buildAgentSelectionSection(agents: AvailableAgent[]): string;
export declare function buildCategorySection(userCategories?: Record<string, CategoryConfig>): string;
export declare function buildSkillsSection(skills: AvailableSkill[]): string;
export declare function buildDecisionMatrix(agents: AvailableAgent[], userCategories?: Record<string, CategoryConfig>): string;
