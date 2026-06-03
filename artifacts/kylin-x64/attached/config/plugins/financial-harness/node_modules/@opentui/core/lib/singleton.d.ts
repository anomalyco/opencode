/**
 * Ensures a value is initialized once per process,
 * persists across Bun hot reloads, and is type-safe.
 */
export declare function singleton<T>(key: string, factory: () => T): T;
export declare function destroySingleton(key: string): void;
export declare function hasSingleton(key: string): boolean;
