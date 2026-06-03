import type { AvailableAgent, AvailableCategory, AvailableSkill } from "./dynamic-agent-prompt-types";
export declare function buildHardBlocksSection(): string;
export declare function buildAntiPatternsSection(): string;
export declare function buildToolCallFormatSection(): string;
export declare function buildUltraworkSection(agents: AvailableAgent[], categories: AvailableCategory[], skills: AvailableSkill[]): string;
export declare function buildAntiDuplicationSection(): string;
