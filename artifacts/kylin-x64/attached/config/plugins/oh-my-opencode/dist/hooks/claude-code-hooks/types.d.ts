/**
 * Claude Code Hooks Type Definitions
 * Maps Claude Code hook concepts to OpenCode plugin events
 */
export type ClaudeHookEvent = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop" | "PreCompact";
export interface HookMatcher {
    matcher: string;
    hooks: HookAction[];
}
export interface HookCommand {
    type: "command";
    command: string;
}
export interface HookHttp {
    type: "http";
    url: string;
    headers?: Record<string, string>;
    allowedEnvVars?: string[];
    timeout?: number;
}
export type HookAction = HookCommand | HookHttp;
export interface ClaudeHooksConfig {
    PreToolUse?: HookMatcher[];
    PostToolUse?: HookMatcher[];
    UserPromptSubmit?: HookMatcher[];
    Stop?: HookMatcher[];
    PreCompact?: HookMatcher[];
}
export interface PreToolUseInput {
    session_id: string;
    transcript_path?: string;
    cwd: string;
    permission_mode?: PermissionMode;
    hook_event_name: "PreToolUse";
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_use_id?: string;
    hook_source?: HookSource;
}
export interface PostToolUseInput {
    session_id: string;
    transcript_path?: string;
    cwd: string;
    permission_mode?: PermissionMode;
    hook_event_name: "PostToolUse";
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_response: {
        title?: string;
        output?: string;
        [key: string]: unknown;
    };
    tool_use_id?: string;
    hook_source?: HookSource;
}
export interface UserPromptSubmitInput {
    session_id: string;
    cwd: string;
    permission_mode?: PermissionMode;
    hook_event_name: "UserPromptSubmit";
    prompt: string;
    session?: {
        id: string;
    };
    hook_source?: HookSource;
}
export type PermissionMode = "default" | "plan" | "acceptEdits" | "bypassPermissions";
export type HookSource = "opencode-plugin";
export interface StopInput {
    session_id: string;
    transcript_path?: string;
    cwd: string;
    permission_mode?: PermissionMode;
    hook_event_name: "Stop";
    stop_hook_active: boolean;
    todo_path?: string;
    hook_source?: HookSource;
}
export interface PreCompactInput {
    session_id: string;
    cwd: string;
    hook_event_name: "PreCompact";
    hook_source?: HookSource;
}
export type PermissionDecision = "allow" | "deny" | "ask";
/**
 * Common JSON fields for all hook outputs (Claude Code spec)
 */
export interface HookCommonOutput {
    /** If false, Claude stops entirely */
    continue?: boolean;
    /** Message shown to user when continue=false */
    stopReason?: string;
    /** Suppress output from transcript */
    suppressOutput?: boolean;
    /** Warning/message displayed to user */
    systemMessage?: string;
}
export interface PreToolUseOutput extends HookCommonOutput {
    /** Deprecated: use hookSpecificOutput.permissionDecision instead */
    decision?: "allow" | "deny" | "approve" | "block" | "ask";
    /** Deprecated: use hookSpecificOutput.permissionDecisionReason instead */
    reason?: string;
    hookSpecificOutput?: {
        hookEventName: "PreToolUse";
        permissionDecision: PermissionDecision;
        permissionDecisionReason?: string;
        updatedInput?: Record<string, unknown>;
    };
}
export interface PostToolUseOutput extends HookCommonOutput {
    decision?: "block";
    reason?: string;
    hookSpecificOutput?: {
        hookEventName: "PostToolUse";
        /** Additional context to provide to Claude */
        additionalContext?: string;
    };
}
export interface HookResult {
    exitCode: number;
    stdout?: string;
    stderr?: string;
}
export interface TranscriptEntry {
    type: "tool_use" | "tool_result" | "user" | "assistant";
    timestamp: string;
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    tool_output?: Record<string, unknown>;
    content?: string;
}
export interface TodoItem {
    id: string;
    content: string;
    status: "pending" | "in_progress" | "completed" | "cancelled";
    priority?: "low" | "medium" | "high";
    created_at: string;
    updated_at?: string;
}
export interface ClaudeCodeTodoItem {
    content: string;
    status: string;
    activeForm: string;
}
export interface TodoFile {
    session_id: string;
    items: TodoItem[];
    created_at: string;
    updated_at: string;
}
export interface StopOutput {
    decision?: "block" | "continue";
    reason?: string;
    stop_hook_active?: boolean;
    permission_mode?: PermissionMode;
    inject_prompt?: string;
}
export interface PreCompactOutput extends HookCommonOutput {
    /** Additional context to inject into compaction prompt */
    context?: string[];
    hookSpecificOutput?: {
        hookEventName: "PreCompact";
        /** Additional context strings to inject */
        additionalContext?: string[];
    };
}
export type ClaudeCodeContent = {
    type: "text";
    text: string;
} | {
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;
} | {
    type: "tool_result";
    tool_use_id: string;
    content: string;
};
export interface ClaudeCodeMessage {
    type: "user" | "assistant";
    message: {
        role: "user" | "assistant";
        content: ClaudeCodeContent[];
    };
}
export interface PluginConfig {
    disabledHooks?: boolean | ClaudeHookEvent[];
    keywordDetectorDisabled?: boolean;
}
