import type { LazyContentLoader } from "../../features/opencode-skill-loader";
export type CommandScope = "builtin" | "config" | "user" | "project" | "opencode" | "opencode-project" | "plugin";
export interface CommandMetadata {
    name: string;
    description: string;
    argumentHint?: string;
    model?: string;
    agent?: string;
    subtask?: boolean;
}
export interface CommandInfo {
    name: string;
    path?: string;
    metadata: CommandMetadata;
    content?: string;
    scope: CommandScope;
    lazyContentLoader?: LazyContentLoader;
}
