import type { CategoryConfig, CategoriesConfig } from "../../config/schema";
export interface ResolveCategoryConfigOptions {
    userCategories?: CategoriesConfig;
    inheritedModel?: string;
    systemDefaultModel?: string;
    availableModels?: Set<string>;
}
export interface ResolveCategoryConfigResult {
    config: CategoryConfig;
    promptAppend: string;
    model: string | undefined;
    isUserConfiguredModel: boolean;
}
/**
 * Resolve the configuration for a given category name.
 * Merges default and user configurations, handles model resolution.
 */
export declare function resolveCategoryConfig(categoryName: string, options: ResolveCategoryConfigOptions): ResolveCategoryConfigResult | null;
