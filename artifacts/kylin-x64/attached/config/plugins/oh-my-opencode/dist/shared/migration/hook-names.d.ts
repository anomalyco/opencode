export declare const HOOK_NAME_MAP: Record<string, string | null>;
export declare function migrateHookNames(hooks: string[]): {
    migrated: string[];
    changed: boolean;
    removed: string[];
};
