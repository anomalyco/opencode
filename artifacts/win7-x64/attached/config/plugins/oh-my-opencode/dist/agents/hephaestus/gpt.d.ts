/** Generic GPT Hephaestus prompt - fallback for GPT models without a model-specific variant */
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder";
export declare function buildHephaestusPrompt(availableAgents?: AvailableAgent[], availableTools?: AvailableTool[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): string;
