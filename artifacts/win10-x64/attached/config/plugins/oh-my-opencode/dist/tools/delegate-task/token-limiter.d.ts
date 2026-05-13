import type { BuildSystemContentInput } from "./types";
export declare function estimateTokenCount(text: string): number;
export declare function truncateToTokenBudget(content: string, maxTokens: number): string;
export declare function buildSystemContentWithTokenLimit(input: BuildSystemContentInput, maxTokens: number | undefined): string | undefined;
