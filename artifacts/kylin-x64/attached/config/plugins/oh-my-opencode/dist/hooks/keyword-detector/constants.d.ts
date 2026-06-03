export declare const CODE_BLOCK_PATTERN: RegExp;
export declare const INLINE_CODE_PATTERN: RegExp;
export { isPlannerAgent, isNonOmoAgent, getUltraworkMessage } from "./ultrawork";
export { SEARCH_PATTERN, SEARCH_MESSAGE } from "./search";
export { ANALYZE_PATTERN, ANALYZE_MESSAGE } from "./analyze";
export type KeywordDetector = {
    pattern: RegExp;
    message: string | ((agentName?: string, modelID?: string) => string);
};
export declare const KEYWORD_DETECTORS: KeywordDetector[];
