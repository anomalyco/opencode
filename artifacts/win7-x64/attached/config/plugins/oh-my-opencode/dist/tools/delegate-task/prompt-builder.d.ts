import type { BuildSystemContentInput } from "./types";
/**
 * Build the system content to inject into the agent prompt.
 * Combines skill content, category prompt append, and plan agent system prepend.
 */
export declare function buildSystemContent(input: BuildSystemContentInput): string | undefined;
export declare function buildTaskPrompt(prompt: string, agentName: string | undefined, tddEnabled?: boolean): string;
