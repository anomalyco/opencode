import type { PluginInput } from "@opencode-ai/plugin";
export declare const JSON_ERROR_TOOL_EXCLUDE_LIST: readonly ["bash", "read", "glob", "grep", "webfetch", "look_at", "grep_app_searchgithub", "websearch_web_search_exa"];
export declare const JSON_ERROR_PATTERNS: readonly [RegExp, RegExp, RegExp, RegExp, RegExp, RegExp, RegExp, RegExp];
export declare const JSON_ERROR_REMINDER = "\n[JSON PARSE ERROR - IMMEDIATE ACTION REQUIRED]\n\nYou sent invalid JSON arguments. The system could not parse your tool call.\nSTOP and do this NOW:\n\n1. LOOK at the error message above to see what was expected vs what you sent.\n2. CORRECT your JSON syntax (missing braces, unescaped quotes, trailing commas, etc).\n3. RETRY the tool call with valid JSON.\n\nDO NOT repeat the exact same invalid call.\n";
export declare function createJsonErrorRecoveryHook(_ctx: PluginInput): {
    "tool.execute.after": (input: {
        tool: string;
        sessionID: string;
        callID: string;
    }, output: {
        title: string;
        output: string;
        metadata: unknown;
    }) => Promise<void>;
};
