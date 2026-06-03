import type { CategoryConfig } from "../config/schema";
export declare function resolveCategoryConfig(categoryName: string, userCategories?: Record<string, CategoryConfig>): CategoryConfig | undefined;
