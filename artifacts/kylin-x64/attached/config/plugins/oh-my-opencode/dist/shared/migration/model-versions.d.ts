/**
 * Model version migration map: old full model strings → new full model strings.
 * Used to auto-upgrade hardcoded model versions in user configs when the plugin
 * bumps to newer model versions.
 *
 * Keys are full "provider/model" strings. Only openai and anthropic entries needed.
 */
export declare const MODEL_VERSION_MAP: Record<string, string>;
export declare function migrateModelVersions(configs: Record<string, unknown>, appliedMigrations?: Set<string>): {
    migrated: Record<string, unknown>;
    changed: boolean;
    newMigrations: string[];
};
