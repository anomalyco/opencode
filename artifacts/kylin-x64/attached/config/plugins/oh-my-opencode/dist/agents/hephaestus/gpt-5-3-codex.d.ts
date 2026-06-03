import type { AgentConfig } from "@opencode-ai/sdk";
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder";
/**
 * Hephaestus - The Autonomous Deep Worker
 *
 * Named after the Greek god of forge, fire, metalworking, and craftsmanship.
 * Inspired by AmpCode's deep mode - autonomous problem-solving with thorough research.
 *
 * Powered by GPT Codex models.
 * Optimized for:
 * - Goal-oriented autonomous execution (not step-by-step instructions)
 * - Deep exploration before decisive action
 * - Active use of explore/librarian agents for comprehensive context
 * - End-to-end task completion without premature stopping
 */
export declare function buildHephaestusPrompt(availableAgents?: AvailableAgent[], availableTools?: AvailableTool[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): string;
export declare function createHephaestusAgent(model: string, availableAgents?: AvailableAgent[], availableToolNames?: string[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): AgentConfig;
export declare namespace createHephaestusAgent {
    var mode: "primary";
}
