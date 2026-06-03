import type { CategoriesConfig, CategoryConfig } from "../config/schema";
/**
 * Merge default and user categories, filtering out disabled ones.
 * Single source of truth for category merging across the codebase.
 */
export declare function mergeCategories(userCategories?: CategoriesConfig): Record<string, CategoryConfig>;
