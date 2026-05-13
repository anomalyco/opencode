export type CommandScope = "user" | "project" | "opencode" | "opencode-project";
/**
 * Handoff definition for command workflows.
 * Based on speckit's handoff pattern for multi-agent orchestration.
 * @see https://github.com/github/spec-kit
 */
export interface HandoffDefinition {
    /** Human-readable label for the handoff action */
    label: string;
    /** Target agent/command identifier (e.g., "speckit.tasks") */
    agent: string;
    /** Pre-filled prompt text for the handoff */
    prompt: string;
    /** If true, automatically executes after command completion; if false, shows as suggestion */
    send?: boolean;
}
export interface CommandDefinition {
    name: string;
    description?: string;
    template: string;
    agent?: string;
    model?: string;
    subtask?: boolean;
    argumentHint?: string;
    /** Handoff definitions for workflow transitions */
    handoffs?: HandoffDefinition[];
}
export interface CommandFrontmatter {
    description?: string;
    "argument-hint"?: string;
    agent?: string;
    model?: string;
    subtask?: boolean;
    /** Handoff definitions for workflow transitions */
    handoffs?: HandoffDefinition[];
}
export interface LoadedCommand {
    name: string;
    path: string;
    definition: CommandDefinition;
    scope: CommandScope;
}
