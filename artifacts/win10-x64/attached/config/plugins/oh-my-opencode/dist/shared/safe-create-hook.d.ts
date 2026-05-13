interface SafeCreateHookOptions {
    enabled?: boolean;
}
export declare function safeCreateHook<T>(name: string, factory: () => T, options?: SafeCreateHookOptions): T | null;
export {};
