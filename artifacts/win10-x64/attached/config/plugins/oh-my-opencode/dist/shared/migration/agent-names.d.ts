export declare const AGENT_NAME_MAP: Record<string, string>;
export declare const BUILTIN_AGENT_NAMES: Set<string>;
export declare function migrateAgentNames(agents: Record<string, unknown>): {
    migrated: Record<string, unknown>;
    changed: boolean;
};
