import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import type { FindRuleFilesOptions } from "./rule-file-finder";
import { createContentHash, isDuplicateByContentHash, isDuplicateByRealPath, shouldApplyRule } from "./matcher";
import { saveInjectedRules } from "./storage";
import type { SessionInjectedRulesCache } from "./cache";
type ToolExecuteOutput = {
    title: string;
    output: string;
    metadata: unknown;
};
type DynamicTruncator = {
    truncate: (sessionID: string, content: string) => Promise<{
        result: string;
        truncated: boolean;
    }>;
};
export declare function createRuleInjectionProcessor(deps: {
    workspaceDirectory: string;
    truncator: DynamicTruncator;
    getSessionCache: (sessionID: string) => SessionInjectedRulesCache;
    ruleFinderOptions?: FindRuleFilesOptions;
    readFileSync?: typeof readFileSync;
    statSync?: typeof statSync;
    homedir?: typeof homedir;
    shouldApplyRule?: typeof shouldApplyRule;
    isDuplicateByRealPath?: typeof isDuplicateByRealPath;
    createContentHash?: typeof createContentHash;
    isDuplicateByContentHash?: typeof isDuplicateByContentHash;
    saveInjectedRules?: typeof saveInjectedRules;
}): {
    processFilePathForInjection: (filePath: string, sessionID: string, output: ToolExecuteOutput) => Promise<void>;
};
export {};
