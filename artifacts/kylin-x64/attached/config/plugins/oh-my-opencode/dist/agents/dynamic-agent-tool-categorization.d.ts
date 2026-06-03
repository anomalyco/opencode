import type { AvailableTool } from "./dynamic-agent-prompt-types";
export declare function categorizeTools(toolNames: string[]): AvailableTool[];
export declare function getToolsPromptDisplay(tools: AvailableTool[]): string;
