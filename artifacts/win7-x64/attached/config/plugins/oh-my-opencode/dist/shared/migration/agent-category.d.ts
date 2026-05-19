/**
 * @deprecated LEGACY MIGRATION ONLY
 *
 * This map exists solely for migrating old configs that used hardcoded model strings.
 * It maps legacy model strings to semantic category names, allowing users to migrate
 * from explicit model configs to category-based configs.
 *
 * DO NOT add new entries here. New agents should use:
 * - Category-based config (preferred): { category: "unspecified-high" }
 * - Or inherit from OpenCode's config.model
 *
 * This map will be removed in a future major version once migration period ends.
 */
export declare const MODEL_TO_CATEGORY_MAP: Record<string, string>;
export declare function migrateAgentConfigToCategory(config: Record<string, unknown>): {
    migrated: Record<string, unknown>;
    changed: boolean;
};
export declare function shouldDeleteAgentConfig(config: Record<string, unknown>, category: string): boolean;
