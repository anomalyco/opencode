type AssetFallback = string | URL | (() => string | URL);
export declare function resolveAssetPath(key: string, fallback?: AssetFallback): string;
export declare function resolveAssetRootPath(key: string): string | undefined;
export declare function validateAssetKey(key: string): void;
export {};
